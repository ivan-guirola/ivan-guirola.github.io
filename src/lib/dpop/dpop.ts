import { decodeJwt, generateKey, randomId, sha256, signJwt, thumbprint, verifyJwt, type Jwt, type KeyPair } from '../jose';

export type Mode = 'bearer' | 'dpop';
export type Attack = 'token' | 'ownKey' | 'replay' | 'otherEndpoint';
export type Who = 'app' | 'attacker';
export type Field =
  | 'signature'
  | 'expiry'
  | 'scheme'
  | 'proof'
  | 'proofSignature'
  | 'key'
  | 'method'
  | 'url'
  | 'tokenHash'
  | 'fresh'
  | 'unique';

export interface Exchange {
  who: Who;
  attack?: Attack;
  step: 'token' | 'api';
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  form?: Record<string, string>;
  body?: unknown;
  status: number;
  responseHeaders?: Record<string, string>;
  response?: unknown;
}

export interface Check {
  field: Field;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface Attempt {
  who: Who;
  attack?: Attack;
  call: Exchange;
  accepted: boolean;
  checks: Check[];
}

export interface Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export const ATTACKS: Record<Mode, Attack[]> = {
  bearer: ['token', 'otherEndpoint'],
  dpop: ['token', 'ownKey', 'replay', 'otherEndpoint'],
};

export const SERVER = 'https://auth.bank.example';
export const API = 'https://api.bank.example';
const ACCOUNTS = `${API}/accounts`;
const TRANSFERS = `${API}/transfers`;
const CLIENT = 'banking-app';
const LIFETIME = 300;
const PROOF_WINDOW = 60;
const clock = (seconds: number) => `${new Date(seconds * 1000).toISOString().slice(11, 19)} UTC`;

interface ApiRequest {
  method: 'GET' | 'POST';
  url: string;
  authorization: string;
  proof?: string;
  body?: unknown;
}

const publicJwk = (key: KeyPair): Jwk => {
  const { kty, crv, x, y } = key.publicJwk;
  return { kty, crv, x, y };
};

export interface DpopSession {
  mode: Mode;
  appKey: Jwk;
  appThumbprint: string;
  attackerKey: Jwk;
  attackerThumbprint: string;
  calls: Exchange[];
  token: string | undefined;
  claims: Jwt | undefined;
  lastProof: string | undefined;
  getToken(): Promise<Exchange>;
  callApi(): Promise<Attempt>;
  steal(attack: Attack): Promise<Attempt>;
}

/**
 * An app gets an access token and calls an API with it, either as a plain bearer token or bound to the app's key with
 * DPoP (RFC 9449). An attacker who copied the token, and the app's last request, then tries to use it.
 */
export async function startDpop(mode: Mode, now = Date.now()): Promise<DpopSession> {
  const [server, app, attacker] = await Promise.all([
    generateKey('auth.bank.example-1'),
    generateKey('app'),
    generateKey('attacker'),
  ]);
  const seconds = Math.floor(now / 1000);
  const used = new Set<string>();
  let lastAppRequest: ApiRequest | undefined;

  const proofFor = async (key: KeyPair, method: string, url: string, accessToken?: string) =>
    signJwt(
      { typ: 'dpop+jwt', jwk: publicJwk(key) },
      { jti: randomId(), htm: method, htu: url, iat: seconds, ...(accessToken ? { ath: await sha256(accessToken) } : {}) },
      key,
    );

  async function check(request: ApiRequest): Promise<Check[]> {
    const [scheme = '', token = ''] = request.authorization.split(' ');
    const { payload } = decodeJwt(token);
    const valid = await verifyJwt(token, server.publicJwk);
    const checks: Check[] = [
      { field: 'signature', expected: 'signed by the bank', actual: valid ? 'valid' : 'invalid', ok: valid },
      { field: 'expiry', expected: `until ${clock(payload.exp)}`, actual: `now ${clock(seconds)}`, ok: payload.exp > seconds },
    ];

    const jkt: string | undefined = payload.cnf?.jkt;
    if (!jkt) {
      checks.push({ field: 'scheme', expected: 'Bearer', actual: scheme, ok: scheme === 'Bearer' });
      return checks;
    }

    checks.push({ field: 'scheme', expected: 'DPoP', actual: scheme, ok: scheme === 'DPoP' });
    checks.push({ field: 'proof', expected: 'a DPoP proof', actual: request.proof ? 'present' : 'missing', ok: !!request.proof });
    if (!request.proof) return checks;

    const proof = decodeJwt(request.proof);
    const jwk = proof.header.jwk as Jwk;
    const signed = proof.header.typ === 'dpop+jwt' && (await verifyJwt(request.proof, { ...jwk, kid: '' }));
    const holder = await thumbprint(jwk);
    const hash = await sha256(token);
    const age = seconds - proof.payload.iat;
    checks.push(
      { field: 'proofSignature', expected: 'valid, with the key in its header', actual: signed ? 'valid' : 'invalid', ok: signed },
      { field: 'key', expected: jkt, actual: holder, ok: holder === jkt },
      { field: 'method', expected: request.method, actual: proof.payload.htm, ok: proof.payload.htm === request.method },
      { field: 'url', expected: request.url, actual: proof.payload.htu, ok: proof.payload.htu === request.url },
      { field: 'tokenHash', expected: hash, actual: proof.payload.ath ?? '—', ok: proof.payload.ath === hash },
      { field: 'fresh', expected: `at most ${PROOF_WINDOW} s old`, actual: `${age} s old`, ok: age >= 0 && age <= PROOF_WINDOW },
      {
        field: 'unique',
        expected: 'a jti never seen',
        actual: used.has(proof.payload.jti) ? 'seen before' : 'new',
        ok: !used.has(proof.payload.jti),
      },
    );
    return checks;
  }

  async function api(who: Who, request: ApiRequest, attack?: Attack): Promise<Attempt> {
    const checks = await check(request);
    const accepted = checks.every((item) => item.ok);
    if (accepted && request.proof) used.add(decodeJwt(request.proof).payload.jti);
    const failed = checks.find((item) => !item.ok);
    const error = failed && ['scheme', 'proof', 'signature', 'expiry'].includes(failed.field) ? 'invalid_token' : 'invalid_dpop_proof';
    const scheme = session.claims?.payload.cnf ? 'DPoP' : 'Bearer';

    const call: Exchange = {
      who,
      attack,
      step: 'api',
      method: request.method,
      url: request.url,
      headers: {
        Authorization: request.authorization,
        ...(request.proof ? { DPoP: request.proof } : {}),
        ...(request.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: request.body,
      status: accepted ? (request.method === 'POST' ? 201 : 200) : 401,
      responseHeaders: accepted ? undefined : { 'WWW-Authenticate': `${scheme} error="${error}", algs="ES256"` },
      response: accepted
        ? request.method === 'POST'
          ? { id: `tr-${randomId(4)}`, status: 'accepted' }
          : { accounts: [{ iban: 'ES91 2100 0418 4502 0005 1332', balance: { amount: '2340.18', currency: 'EUR' } }] }
        : { error, error_description: `${failed!.field}: expected ${failed!.expected}, got ${failed!.actual}` },
    };
    session.calls.push(call);
    return { who, attack, call, accepted, checks };
  }

  const session: DpopSession = {
    mode,
    appKey: publicJwk(app),
    appThumbprint: await thumbprint(publicJwk(app)),
    attackerKey: publicJwk(attacker),
    attackerThumbprint: await thumbprint(publicJwk(attacker)),
    calls: [],
    token: undefined,
    claims: undefined,
    lastProof: undefined,

    async getToken() {
      const url = `${SERVER}/token`;
      const proof = mode === 'dpop' ? await proofFor(app, 'POST', url) : undefined;
      const claims = {
        iss: SERVER,
        sub: 'laura.martin',
        aud: API,
        client_id: CLIENT,
        iat: seconds,
        exp: seconds + LIFETIME,
        jti: randomId(),
        scope: 'accounts transfers',
        ...(proof ? { cnf: { jkt: await thumbprint(decodeJwt(proof).header.jwk) } } : {}),
      };
      const token = await signJwt({ typ: 'at+jwt' }, claims, server);
      session.token = token;
      session.claims = decodeJwt(token);
      const call: Exchange = {
        who: 'app',
        step: 'token',
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(proof ? { DPoP: proof } : {}) },
        form: {
          grant_type: 'authorization_code',
          code: randomId(16),
          redirect_uri: 'https://app.example/callback',
          code_verifier: randomId(32),
          client_id: CLIENT,
        },
        status: 200,
        response: { access_token: token, token_type: proof ? 'DPoP' : 'Bearer', expires_in: LIFETIME, scope: claims.scope },
      };
      session.calls.push(call);
      return call;
    },

    async callApi() {
      const token = session.token;
      if (!token) throw new Error('get a token first');
      const proof = mode === 'dpop' ? await proofFor(app, 'GET', ACCOUNTS, token) : undefined;
      lastAppRequest = { method: 'GET', url: ACCOUNTS, authorization: `${proof ? 'DPoP' : 'Bearer'} ${token}`, proof };
      session.lastProof = proof;
      return api('app', lastAppRequest);
    },

    async steal(attack) {
      const token = session.token;
      if (!token || !lastAppRequest) throw new Error('the app has not used its token yet');
      const transfer = { to: 'DE89 3704 0044 0532 0130 00', amount: { amount: '4500.00', currency: 'EUR' } };
      switch (attack) {
        case 'token':
          return api('attacker', { method: 'GET', url: ACCOUNTS, authorization: `Bearer ${token}` }, attack);
        case 'ownKey':
          return api(
            'attacker',
            { method: 'GET', url: ACCOUNTS, authorization: `DPoP ${token}`, proof: await proofFor(attacker, 'GET', ACCOUNTS, token) },
            attack,
          );
        case 'replay':
          return api('attacker', { ...lastAppRequest }, attack);
        case 'otherEndpoint':
          return api(
            'attacker',
            { method: 'POST', url: TRANSFERS, authorization: lastAppRequest.authorization, proof: lastAppRequest.proof, body: transfer },
            attack,
          );
      }
    },
  };
  return session;
}

export function requestText(call: Exchange) {
  const url = new URL(call.url);
  const lines = [`${call.method} ${url.pathname} HTTP/1.1`, `Host: ${url.host}`];
  for (const [key, value] of Object.entries(call.headers)) lines.push(`${key}: ${value}`);
  if (call.form) lines.push('', Object.entries(call.form).map(([key, value]) => `${key}=${value}`).join('\n&'));
  else if (call.body) lines.push('', JSON.stringify(call.body, null, 2));
  return lines.join('\n');
}

const REASONS: Record<number, string> = { 200: 'OK', 201: 'Created', 401: 'Unauthorized' };

export function responseText(call: Exchange) {
  const lines = [`HTTP/1.1 ${call.status} ${REASONS[call.status] ?? ''}`.trim()];
  for (const [key, value] of Object.entries(call.responseHeaders ?? {})) lines.push(`${key}: ${value}`);
  if (call.response) lines.push('Content-Type: application/json', '', JSON.stringify(call.response, null, 2));
  return lines.join('\n');
}
