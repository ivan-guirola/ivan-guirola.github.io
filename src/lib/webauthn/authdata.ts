import { toBase64Url, toHex } from './bytes';
import { decodeCbor } from './cbor';

export interface AuthenticatorFlags {
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backupState: boolean;
  attestedCredentialData: boolean;
  extensionData: boolean;
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: AuthenticatorFlags;
  signCount: number;
  credential?: { aaguid: string; credentialId: Uint8Array; cose: Map<number | string, unknown> };
}

const HEADER = 37;

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < HEADER) throw new Error('Authenticator data is too short');

  const bits = bytes[32];
  const flags: AuthenticatorFlags = {
    userPresent: (bits & 0x01) !== 0,
    userVerified: (bits & 0x04) !== 0,
    backupEligible: (bits & 0x08) !== 0,
    backupState: (bits & 0x10) !== 0,
    attestedCredentialData: (bits & 0x40) !== 0,
    extensionData: (bits & 0x80) !== 0,
  };
  const data: AuthenticatorData = {
    rpIdHash: bytes.slice(0, 32),
    flags,
    signCount: new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0),
  };
  if (!flags.attestedCredentialData) return data;

  if (bytes.length < HEADER + 18) throw new Error('Attested credential data is truncated');
  const hex = toHex(bytes.subarray(37, 53));
  const idLength = (bytes[53] << 8) | bytes[54];
  const idEnd = 55 + idLength;
  if (bytes.length < idEnd) throw new Error('Attested credential data is truncated');

  const cose = decodeCbor(bytes, idEnd).value;
  if (!(cose instanceof Map)) throw new Error('Credential public key is not a COSE map');

  data.credential = {
    aaguid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    credentialId: bytes.slice(55, idEnd),
    cose,
  };
  return data;
}

export interface PublicKey {
  alg: -7 | -257;
  name: 'ES256' | 'RS256';
  jwk: JsonWebKey;
}

export function coseToJwk(cose: Map<number | string, unknown>): PublicKey {
  const kty = cose.get(1);
  const alg = cose.get(3);
  const bytes = (label: number) => {
    const value = cose.get(label);
    if (!(value instanceof Uint8Array)) throw new Error(`COSE key is missing parameter ${label}`);
    return toBase64Url(value);
  };

  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg: -7, name: 'ES256', jwk: { kty: 'EC', crv: 'P-256', x: bytes(-2), y: bytes(-3) } };
  }
  if (kty === 3 && alg === -257) {
    return { alg: -257, name: 'RS256', jwk: { kty: 'RSA', alg: 'RS256', n: bytes(-1), e: bytes(-2) } };
  }
  throw new Error(`Unsupported COSE key (kty ${String(kty)}, alg ${String(alg)})`);
}

export function derToRaw(der: Uint8Array, size: number): Uint8Array {
  let offset = 0;
  const expect = (tag: number) => {
    if (der[offset++] !== tag) throw new Error('Not a DER ECDSA signature');
    let length = der[offset++];
    if (length === 0x81) length = der[offset++];
    return length;
  };
  const integer = () => {
    const length = expect(0x02);
    let value = der.subarray(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size || offset > der.length) throw new Error('Not a DER ECDSA signature');
    return value;
  };

  expect(0x30);
  const raw = new Uint8Array(size * 2);
  const r = integer();
  const s = integer();
  raw.set(r, size - r.length);
  raw.set(s, size * 2 - s.length);
  return raw;
}
