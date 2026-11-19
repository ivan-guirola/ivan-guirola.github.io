import { describe, expect, it } from 'vitest';
import { detectInput } from './detect';

describe('detectInput', () => {
  it('recognises an address', () => {
    expect(detectInput('  https://login.example.com/realms/demo \n')).toEqual({
      kind: 'url',
      url: 'https://login.example.com/realms/demo',
    });
  });

  it('recognises SAML metadata', () => {
    const xml = '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x"/>';
    expect(detectInput(xml)).toEqual({ kind: 'saml', xml });
  });

  it('recognises a discovery document', () => {
    const json = '{"issuer":"https://a.example"}';
    expect(detectInput(json)).toEqual({ kind: 'oidc', json });
  });

  it('recognises a key set', () => {
    const json = '{"keys":[]}';
    expect(detectInput(json)).toEqual({ kind: 'jwks', json });
  });

  it('does not recognise other XML, other JSON, broken JSON or plain text', () => {
    for (const text of ['<html/>', '{"a":1}', '{"issuer":', 'hello', '', 'https://a.example and more text']) {
      expect(detectInput(text)).toEqual({ kind: 'unknown' });
    }
  });

  it('does not treat other schemes as an address', () => {
    expect(detectInput('ftp://a.example')).toEqual({ kind: 'unknown' });
  });
});
