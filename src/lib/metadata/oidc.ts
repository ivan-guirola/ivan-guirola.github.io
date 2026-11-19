import { parseCertificate, type Certificate } from './certificate';

export interface Discovery {
  issuer: string;
  endpoints: { name: string; url: string }[];
  scopes: string[];
  responseTypes: string[];
  grantTypes: string[];
  signingAlgorithms: string[];
  pkceMethods: string[];
  clientAuthMethods: string[];
}

export interface JwksKey {
  kid?: string;
  type: string;
  use?: string;
  alg?: string;
  certificate?: Certificate;
  source?: string;
}

export interface Finding {
  code: 'issuerMismatch' | 'insecureEndpoint';
  detail: string;
}

const WELL_KNOWN = /\/\.well-known\/(openid-configuration|oauth-authorization-server)\/?$/;

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Malformed JSON');
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

export function parseDiscovery(json: string): Discovery {
  const document = parse(json);
  if (!isRecord(document) || typeof document.issuer !== 'string') throw new Error('Not a discovery document');

  return {
    issuer: document.issuer,
    endpoints: Object.entries(document)
      .filter(([name, url]) => (name.endsWith('_endpoint') || name === 'jwks_uri') && typeof url === 'string')
      .map(([name, url]) => ({ name, url: url as string })),
    scopes: list(document.scopes_supported),
    responseTypes: list(document.response_types_supported),
    grantTypes: list(document.grant_types_supported),
    signingAlgorithms: list(document.id_token_signing_alg_values_supported),
    pkceMethods: list(document.code_challenge_methods_supported),
    clientAuthMethods: list(document.token_endpoint_auth_methods_supported),
  };
}

export function discoveryUrl(input: string): string {
  if (WELL_KNOWN.test(input)) return input;
  return `${input.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

const isLocal = (url: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
const withoutSlash = (url: string) => url.replace(/\/+$/, '');

export function checkDiscovery(discovery: Discovery, source?: string): Finding[] {
  const findings: Finding[] = [];
  if (source && withoutSlash(source.replace(WELL_KNOWN, '')) !== withoutSlash(discovery.issuer)) {
    findings.push({ code: 'issuerMismatch', detail: discovery.issuer });
  }
  for (const { name, url } of discovery.endpoints) {
    if (url.startsWith('http://') && !isLocal(url)) findings.push({ code: 'insecureEndpoint', detail: name });
  }
  return findings;
}

function typeOf(key: Record<string, unknown>): string {
  if (key.kty === 'RSA' && typeof key.n === 'string') return `RSA ${Math.floor((key.n.length * 3) / 4) * 8}`;
  return [text(key.kty) ?? 'Unknown', text(key.crv)].filter(Boolean).join(' ');
}

export function parseJwks(json: string): JwksKey[] {
  const document = parse(json);
  if (!isRecord(document) || !Array.isArray(document.keys)) throw new Error('Not a key set');

  return document.keys.filter(isRecord).map((entry) => {
    const key: JwksKey = { type: typeOf(entry) };
    if (text(entry.kid)) key.kid = text(entry.kid);
    if (text(entry.use)) key.use = text(entry.use);
    if (text(entry.alg)) key.alg = text(entry.alg);
    const source = list(entry.x5c)[0];
    try {
      key.certificate = parseCertificate(source ?? '');
      key.source = source;
    } catch {}
    return key;
  });
}
