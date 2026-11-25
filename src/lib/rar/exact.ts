import { decodeJwt, generateKey, randomId, sha256, signJwt, verifyJwt, type Jwt, type PublicJwk } from './jose';

export type Mode = 'scope' | 'rar';
export type CaseId = 'payment' | 'agent';
export type Step = 'par' | 'authorize' | 'callback' | 'token' | 'api';
export type Destination = keyof typeof DESTINATIONS;

export interface Exchange {
  step: Step;
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  form?: Record<string, string>;
  body?: unknown;
  status: number;
  responseHeaders?: Record<string, string>;
  response?: unknown;
}

export interface Input {
  amount: string;
  destination: Destination;
  maxPrice: string;
}

export type Field =
  | 'signature'
  | 'expiry'
  | 'audience'
  | 'scope'
  | 'location'
  | 'action'
  | 'amount'
  | 'currency'
  | 'payee'
  | 'payeeName'
  | 'origin'
  | 'destination'
  | 'cabin'
  | 'price'
  | 'departure'
  | 'once';

export interface FieldCheck {
  field: Field;
  allowed: string;
  requested: string;
  ok: boolean;
}

export interface Attempt {
  id: string;
  call: Exchange;
  accepted: boolean;
  checks: FieldCheck[];
}

interface ApiRequest {
  path: string;
  body: Record<string, any>;
}

type Detail = Record<string, any>;

interface CaseDef {
  client: { id: string; name: string };
  server: { origin: string; name: string };
  api: string;
  scope: string;
  details(input: Input, now: number): Detail[];
  attempts(input: Input, now: number): Record<string, ApiRequest>;
  check(detail: Detail, request: ApiRequest, api: string): FieldCheck[];
}

export const DESTINATIONS = {
  LIS: { city: 'Lisbon', fare: '289.00' },
  OPO: { city: 'Porto', fare: '214.00' },
  BCN: { city: 'Barcelona', fare: '118.00' },
} as const;

export const DEFAULT_INPUT: Input = { amount: '45.00', destination: 'LIS', maxPrice: '300.00' };

const STORE_IBAN = 'DE02100100109307118603';
const OTHER_IBAN = 'DE89370400440532013000';
const CURRENCY = 'EUR';

const money = (value: number) => value.toFixed(2);
const clock = (seconds: number) => `${new Date(seconds * 1000).toISOString().slice(11, 19)} UTC`;
const same = (field: Field, allowed: unknown, requested: unknown): FieldCheck => ({
  field,
  allowed: String(allowed ?? '—'),
  requested: String(requested ?? '—'),
  ok: allowed === requested,
});

/** The next Friday after `now`, as a date. */
export function nextFriday(now: number) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + ((5 - date.getUTCDay() + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

function location(detail: Detail, request: ApiRequest, api: string): FieldCheck {
  const url = api + request.path;
  const allowed: string[] = detail.locations ?? [];
  return { field: 'location', allowed: allowed.join(', '), requested: url, ok: allowed.includes(url) };
}

function action(detail: Detail, wanted: string): FieldCheck {
  const allowed: string[] = detail.actions ?? [];
  return { field: 'action', allowed: allowed.join(', '), requested: wanted, ok: allowed.includes(wanted) };
}

const payment: CaseDef = {
  client: { id: 'example-store', name: 'Example Store' },
  server: { origin: 'https://auth.bank.example', name: 'Your bank' },
  api: 'https://api.bank.example',
  scope: 'payments',
  details: ({ amount }) => [
    {
      type: 'payment_initiation',
      actions: ['initiate'],
      locations: ['https://api.bank.example/payments'],
      instructedAmount: { currency: CURRENCY, amount },
      creditorName: 'Example Store',
      creditorAccount: { iban: STORE_IBAN },
      remittanceInformationUnstructured: 'Order 10482',
    },
  ],
  attempts({ amount }) {
    const pay = (value: string, creditorName: string, iban: string, reference: string): ApiRequest => ({
      path: '/payments',
      body: {
        instructedAmount: { currency: CURRENCY, amount: value },
        creditorName,
        creditorAccount: { iban },
        remittanceInformationUnstructured: reference,
      },
    });
    return {
      agreed: pay(amount, 'Example Store', STORE_IBAN, 'Order 10482'),
      amount: pay(money(Number(amount) * 10), 'Example Store', STORE_IBAN, 'Order 10482'),
      payee: pay('4500.00', 'Unknown Ltd', OTHER_IBAN, 'Invoice 77'),
      again: pay(amount, 'Example Store', STORE_IBAN, 'Order 10482'),
    };
  },
  check(detail, request, api) {
    const where = location(detail, request, api);
    if (!where.ok) return [where];
    const body = request.body;
    return [
      where,
      action(detail, 'initiate'),
      same('amount', detail.instructedAmount?.amount, body.instructedAmount?.amount),
      same('currency', detail.instructedAmount?.currency, body.instructedAmount?.currency),
      same('payee', detail.creditorAccount?.iban, body.creditorAccount?.iban),
      same('payeeName', detail.creditorName, body.creditorName),
    ];
  },
};

const agent: CaseDef = {
  client: { id: 'travel-assistant', name: 'Travel assistant' },
  server: { origin: 'https://auth.skyway.example', name: 'Your Skyway account' },
  api: 'https://api.skyway.example',
  scope: 'bookings',
  details: ({ destination, maxPrice }, now) => [
    {
      type: 'flight_booking',
      actions: ['book'],
      locations: ['https://api.skyway.example/bookings'],
      origin: 'MAD',
      destination,
      cabin: 'economy',
      passengers: 1,
      departBy: nextFriday(now),
      maxPrice: { currency: CURRENCY, amount: maxPrice },
    },
  ],
  attempts({ destination }, now) {
    const friday = nextFriday(now);
    const flight = (to: string, cabin: string, price: string): ApiRequest => ({
      path: '/bookings',
      body: {
        origin: 'MAD',
        destination: to,
        cabin,
        passengers: 1,
        departure: `${friday}T08:40`,
        price: { currency: CURRENCY, amount: price },
      },
    });
    return {
      agreed: flight(destination, 'economy', DESTINATIONS[destination].fare),
      business: flight(destination, 'business', '1240.00'),
      elsewhere: flight('JFK', 'economy', '640.00'),
      hotel: {
        path: '/hotels',
        body: { city: DESTINATIONS[destination].city, nights: 3, price: { currency: CURRENCY, amount: '420.00' } },
      },
      again: flight(destination, 'economy', DESTINATIONS[destination].fare),
    };
  },
  check(detail, request, api) {
    const where = location(detail, request, api);
    if (!where.ok) return [where];
    const body = request.body;
    const max = detail.maxPrice?.amount;
    const price = body.price?.amount;
    const departure = String(body.departure ?? '').slice(0, 10);
    return [
      where,
      action(detail, 'book'),
      same('origin', detail.origin, body.origin),
      same('destination', detail.destination, body.destination),
      same('cabin', detail.cabin, body.cabin),
      { field: 'price', allowed: `up to ${max}`, requested: String(price), ok: Number(price) <= Number(max) },
      same('currency', detail.maxPrice?.currency, body.price?.currency),
      { field: 'departure', allowed: `by ${detail.departBy}`, requested: departure, ok: departure <= detail.departBy },
    ];
  },
};

export const CASES: Record<CaseId, CaseDef> = { payment, agent };
export const ATTEMPTS: Record<CaseId, string[]> = {
  payment: ['agreed', 'amount', 'payee', 'again'],
  agent: ['agreed', 'business', 'elsewhere', 'hotel', 'again'],
};

const REDIRECT: Record<CaseId, string> = {
  payment: 'https://store.example/callback',
  agent: 'https://assistant.example/callback',
};
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const LIFETIME = 300;

export interface Session {
  caseId: CaseId;
  mode: Mode;
  details: Detail[] | undefined;
  scope: string | undefined;
  calls: Exchange[];
  serverKey: PublicJwk;
  clientKey: PublicJwk;
  token: string | undefined;
  claims: Jwt | undefined;
  approve(): Promise<Exchange[]>;
  attempt(id: string): Promise<Attempt>;
}

/**
 * Runs the authorization code flow of FAPI 2.0 (pushed request, PKCE, private_key_jwt) asking either for a scope or for
 * authorization_details, and then lets the app call the API with the token it got.
 */
export async function startSession(caseId: CaseId, mode: Mode, input: Input, now = Date.now()): Promise<Session> {
  const def = CASES[caseId];
  const [serverKey, clientKey] = await Promise.all([generateKey(`${new URL(def.server.origin).host}-1`), generateKey(`${def.client.id}-1`)]);
  const seconds = Math.floor(now / 1000);
  const details = mode === 'rar' ? def.details(input, now) : undefined;
  const scope = mode === 'scope' ? def.scope : undefined;
  const redirect = REDIRECT[caseId];
  const verifier = randomId(32);
  const state = randomId(8);
  const requestUri = `urn:ietf:params:oauth:request_uri:${randomId(12)}`;
  const assertion = () =>
    signJwt(
      { typ: 'JWT' },
      { iss: def.client.id, sub: def.client.id, aud: def.server.origin, jti: randomId(), iat: seconds, exp: seconds + 60 },
      clientKey,
    );
  const ask: Record<string, string> = details ? { authorization_details: JSON.stringify(details) } : { scope: def.scope };

  const calls: Exchange[] = [
    {
      step: 'par',
      method: 'POST',
      url: `${def.server.origin}/par`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form: {
        response_type: 'code',
        client_id: def.client.id,
        redirect_uri: redirect,
        ...ask,
        state,
        code_challenge: await sha256(verifier),
        code_challenge_method: 'S256',
        client_assertion_type: ASSERTION_TYPE,
        client_assertion: await assertion(),
      },
      status: 201,
      response: { request_uri: requestUri, expires_in: 60 },
    },
    {
      step: 'authorize',
      method: 'GET',
      url: `${def.server.origin}/authorize?client_id=${def.client.id}&request_uri=${encodeURIComponent(requestUri)}`,
      status: 200,
    },
  ];

  let used = false;
  const session: Session = {
    caseId,
    mode,
    details,
    scope,
    calls,
    serverKey: serverKey.publicJwk,
    clientKey: clientKey.publicJwk,
    token: undefined,
    claims: undefined,

    async approve() {
      const code = randomId(16);
      const claims = {
        iss: def.server.origin,
        sub: 'laura.martin',
        aud: def.api,
        client_id: def.client.id,
        iat: seconds,
        exp: seconds + LIFETIME,
        jti: randomId(),
        ...(details ? { authorization_details: details } : { scope: def.scope }),
      };
      const token = await signJwt({ typ: 'at+jwt' }, claims, serverKey);
      const added: Exchange[] = [
        {
          step: 'callback',
          method: 'GET',
          url: `${redirect}?code=${code}&state=${state}&iss=${encodeURIComponent(def.server.origin)}`,
          status: 200,
        },
        {
          step: 'token',
          method: 'POST',
          url: `${def.server.origin}/token`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          form: {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirect,
            code_verifier: verifier,
            client_assertion_type: ASSERTION_TYPE,
            client_assertion: await assertion(),
          },
          status: 200,
          response: {
            access_token: token,
            token_type: 'Bearer',
            expires_in: LIFETIME,
            ...(details ? { authorization_details: details } : { scope: def.scope }),
          },
        },
      ];
      calls.push(...added);
      session.token = token;
      session.claims = decodeJwt(token);
      return added;
    },

    async attempt(id) {
      const token = session.token;
      if (!token) throw new Error('approve the request first');
      const request = def.attempts(input, now)[id];
      if (!request) throw new Error(`unknown attempt "${id}"`);
      const { payload } = decodeJwt(token);

      const checks: FieldCheck[] = [
        { field: 'signature', allowed: `ES256, key ${serverKey.publicJwk.kid}`, requested: (await verifyJwt(token, serverKey.publicJwk)) ? 'valid' : 'invalid', ok: await verifyJwt(token, serverKey.publicJwk) },
        { field: 'expiry', allowed: `until ${clock(payload.exp)}`, requested: `now ${clock(seconds)}`, ok: payload.exp > seconds },
        same('audience', def.api, payload.aud),
      ];
      if (mode === 'scope') {
        const granted = String(payload.scope ?? '').split(' ');
        checks.push({ field: 'scope', allowed: granted.join(' '), requested: def.scope, ok: granted.includes(def.scope) });
      } else {
        const detail = (payload.authorization_details as Detail[])[0];
        checks.push(...def.check(detail, request, def.api));
        if (checks.every((check) => check.ok)) {
          checks.push({ field: 'once', allowed: 'one use', requested: used ? 'already used' : 'first use', ok: !used });
        }
      }

      const accepted = checks.every((check) => check.ok);
      if (accepted && mode === 'rar') used = true;
      const failed = checks.find((check) => !check.ok);
      const call: Exchange = {
        step: 'api',
        method: 'POST',
        url: def.api + request.path,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: request.body,
        status: accepted ? 201 : 403,
        response: accepted
          ? { id: `${caseId === 'payment' ? 'pay' : 'bk'}-${randomId(4)}`, status: 'accepted' }
          : { error: 'not_authorized', error_description: `${failed!.field} does not match the token: allowed ${failed!.allowed}, requested ${failed!.requested}` },
      };
      calls.push(call);
      return { id, call, accepted, checks };
    },
  };
  return session;
}

/** The request as it travels, with form fields one per line and decoded so they can be read. */
export function requestText(call: Exchange) {
  const url = new URL(call.url);
  const lines = [`${call.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`];
  for (const [key, value] of Object.entries(call.headers ?? {})) lines.push(`${key}: ${value}`);
  if (call.form) {
    const fields = Object.entries(call.form).map(([key, value]) =>
      key === 'authorization_details' ? `${key}=${JSON.stringify(JSON.parse(value), null, 2)}` : `${key}=${value}`,
    );
    lines.push('', fields.join('\n&'));
  } else if (call.body) lines.push('', JSON.stringify(call.body, null, 2));
  return lines.join('\n');
}

const REASONS: Record<number, string> = { 200: 'OK', 201: 'Created', 403: 'Forbidden' };

export function responseText(call: Exchange) {
  const lines = [`HTTP/1.1 ${call.status} ${REASONS[call.status] ?? ''}`.trim()];
  if (call.response) lines.push('Content-Type: application/json', '', JSON.stringify(call.response, null, 2));
  return lines.join('\n');
}
