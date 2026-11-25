const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
}

export interface KeyPair {
  privateKey: CryptoKey;
  publicJwk: PublicJwk;
}

export function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

export const randomId = (bytes = 16) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function generateKey(kid: string): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: x!, y: y!, kid } };
}

export async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: KeyPair) {
  const head = header.jwk ? { ...header, alg: 'ES256' } : { ...header, alg: 'ES256', kid: key.publicJwk.kid };
  const input = `${base64url(JSON.stringify(head))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(SIGNATURE, key.privateKey, encoder.encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

export interface Jwt {
  header: Record<string, any>;
  payload: Record<string, any>;
}

export function decodeJwt(token: string): Jwt {
  const [header, payload] = token.split('.');
  return {
    header: JSON.parse(decoder.decode(unbase64url(header))),
    payload: JSON.parse(decoder.decode(unbase64url(payload))),
  };
}

export async function verifyJwt(token: string, jwk: PublicJwk): Promise<boolean> {
  const [header, payload, signature] = token.split('.');
  try {
    const { kty, crv, x, y } = jwk;
    const key = await crypto.subtle.importKey('jwk', { kty, crv, x, y }, ALGORITHM, false, ['verify']);
    return await crypto.subtle.verify(SIGNATURE, key, unbase64url(signature), encoder.encode(`${header}.${payload}`));
  } catch {
    return false;
  }
}

/** RFC 7638 thumbprint of an EC public key: the SHA-256 of its required members in lexical order. */
export const thumbprint = ({ crv, kty, x, y }: { crv: string; kty: string; x: string; y: string }) =>
  sha256(JSON.stringify({ crv, kty, x, y }));
