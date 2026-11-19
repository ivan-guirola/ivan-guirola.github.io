import { fromBase64Url } from '../webauthn/bytes';

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

function decodePart(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(part)));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
  return value as Record<string, unknown>;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Not a JWT: expected three parts');
  try {
    return { header: decodePart(parts[0]), payload: decodePart(parts[1]), signature: parts[2] };
  } catch {
    throw new Error('Not a JWT: header and payload must be JSON objects');
  }
}

export type JwtStatus = 'valid' | 'expired' | 'notYetValid' | 'noExpiry';

export interface JwtInfo {
  algorithm: string;
  issuer?: string;
  subject?: string;
  audience: string[];
  issuedAt?: number;
  notBefore?: number;
  expiresAt?: number;
  status: JwtStatus;
  unsigned: boolean;
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export function inspectJwt(jwt: DecodedJwt, now: number): JwtInfo {
  const { header, payload } = jwt;
  const algorithm = text(header.alg) ?? '';
  const notBefore = time(payload.nbf);
  const expiresAt = time(payload.exp);

  let status: JwtStatus = 'valid';
  if (expiresAt !== undefined && now >= expiresAt) status = 'expired';
  else if (notBefore !== undefined && now < notBefore) status = 'notYetValid';
  else if (expiresAt === undefined) status = 'noExpiry';

  return {
    algorithm,
    issuer: text(payload.iss),
    subject: text(payload.sub),
    audience: [payload.aud].flat().filter((item): item is string => typeof item === 'string'),
    issuedAt: time(payload.iat),
    notBefore,
    expiresAt,
    status,
    unsigned: jwt.signature === '' || algorithm.toLowerCase() === 'none',
  };
}
