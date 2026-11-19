import { decodeJwt } from './jwt';

export type Detected =
  | { kind: 'jwt'; token: string }
  | { kind: 'saml'; xml: string; encoding: 'xml' | 'base64' | 'deflate' }
  | { kind: 'unknown' };

const UNKNOWN: Detected = { kind: 'unknown' };
const PARAMETER = /(?:^|[?&#\s])(SAMLResponse|SAMLRequest|id_token|access_token)=([^&#\s]+)/;

const isSaml = (text: string) => text.startsWith('<') && text.includes('urn:oasis:names:tc:SAML');

function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (clean.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<string | null> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function detect(input: string): Promise<Detected> {
  const text = input.trim().replace(/^Bearer\s+/i, '');
  if (!text) return UNKNOWN;

  const parameter = text.match(PARAMETER);
  if (parameter) {
    try {
      return await detect(decodeURIComponent(parameter[2]));
    } catch {
      return UNKNOWN;
    }
  }

  if (text.startsWith('<')) return isSaml(text) ? { kind: 'saml', xml: text, encoding: 'xml' } : UNKNOWN;

  if (/^[\w-]+\.[\w-]+\.[\w-]*$/.test(text)) {
    try {
      decodeJwt(text);
      return { kind: 'jwt', token: text };
    } catch {
      return UNKNOWN;
    }
  }

  const bytes = base64ToBytes(text);
  if (!bytes) return UNKNOWN;

  const plain = new TextDecoder().decode(bytes).trim();
  if (isSaml(plain)) return { kind: 'saml', xml: plain, encoding: 'base64' };

  const inflated = (await inflate(bytes))?.trim();
  if (inflated && isSaml(inflated)) return { kind: 'saml', xml: inflated, encoding: 'deflate' };

  return UNKNOWN;
}
