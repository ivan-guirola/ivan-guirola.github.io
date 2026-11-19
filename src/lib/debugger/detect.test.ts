import { describe, expect, it } from 'vitest';
import { detect } from './detect';
import { toBase64Url } from '../webauthn/bytes';

const XML = '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_1"/>';
const part = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
const JWT = `${part({ alg: 'ES256' })}.${part({ sub: 'ana' })}.c2ln`;
const base64 = (text: string) => btoa(text);

async function deflate(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(String.fromCharCode(...bytes));
}

describe('detect', () => {
  it('recognises a JWT, with or without the Bearer prefix and surrounding space', async () => {
    expect(await detect(JWT)).toEqual({ kind: 'jwt', token: JWT });
    expect(await detect(`  Bearer ${JWT}\n`)).toEqual({ kind: 'jwt', token: JWT });
  });

  it('recognises raw SAML XML', async () => {
    expect(await detect(`\n${XML}`)).toEqual({ kind: 'saml', xml: XML, encoding: 'xml' });
  });

  it('recognises base64 SAML, as sent in a POST binding', async () => {
    expect(await detect(base64(XML))).toEqual({ kind: 'saml', xml: XML, encoding: 'base64' });
  });

  it('accepts base64 broken across lines', async () => {
    const encoded = base64(XML);
    const wrapped = `${encoded.slice(0, 20)}\n${encoded.slice(20)}`;
    expect(await detect(wrapped)).toMatchObject({ kind: 'saml', xml: XML });
  });

  it('recognises deflated SAML, as sent in a redirect binding', async () => {
    expect(await detect(await deflate(XML))).toEqual({ kind: 'saml', xml: XML, encoding: 'deflate' });
  });

  it('pulls a SAML message out of a full URL', async () => {
    const url = `https://sp.test/acs?RelayState=x&SAMLRequest=${encodeURIComponent(await deflate(XML))}&SigAlg=y`;
    expect(await detect(url)).toMatchObject({ kind: 'saml', xml: XML, encoding: 'deflate' });
  });

  it('pulls a token out of a URL fragment', async () => {
    expect(await detect(`https://app.test/cb#state=1&id_token=${JWT}`)).toEqual({ kind: 'jwt', token: JWT });
  });

  it('pulls a SAML response out of a form body', async () => {
    const body = `SAMLResponse=${encodeURIComponent(base64(XML))}&RelayState=abc`;
    expect(await detect(body)).toMatchObject({ kind: 'saml', xml: XML, encoding: 'base64' });
  });

  it('does not recognise XML that is not SAML', async () => {
    expect(await detect('<html><body/></html>')).toEqual({ kind: 'unknown' });
  });

  it('does not recognise empty or arbitrary text', async () => {
    expect(await detect('')).toEqual({ kind: 'unknown' });
    expect(await detect('hello, this is nothing')).toEqual({ kind: 'unknown' });
    expect(await detect('aGVsbG8gd29ybGQ=')).toEqual({ kind: 'unknown' });
    expect(await detect('aaa.bbb.ccc')).toEqual({ kind: 'unknown' });
  });
});
