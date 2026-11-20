export type Approach = 'scope' | 'psd2' | 'rar';
export type Method = 'GET' | 'POST';
export type Step = 'par' | 'createPayment' | 'authorize' | 'approve' | 'token' | 'pay' | 'status';
export type Outcome = 'accepted' | 'newApproval' | 'rejected';

export interface Call {
  step: Step;
  method: Method;
  url: string;
  headers?: Record<string, string>;
  form?: Record<string, string>;
  body?: object;
  status: number;
  responseHeaders?: Record<string, string>;
  response?: object;
}

export interface Scenario {
  approach: Approach;
  calls: Call[];
  consent: { label: string; value: string }[];
  token: Record<string, unknown>;
  misuse: { call: Call; outcome: Outcome };
}

export const APPROACHES: Approach[] = ['scope', 'psd2', 'rar'];

interface Transfer {
  amount: string;
  creditorName: string;
  creditorIban: string;
  reference: string;
}

export const PAYMENT: Transfer = {
  amount: '45.00',
  creditorName: 'Example Store',
  creditorIban: 'DE02100100109307118603',
  reference: 'Order 10482',
};
export const OTHER: Transfer = {
  amount: '4500.00',
  creditorName: 'Unknown Ltd',
  creditorIban: 'DE89370400440532013000',
  reference: 'Invoice 77',
};

const CURRENCY = 'EUR';
const DEBTOR_IBAN = 'DE40100100103307118608';
const AS = 'https://auth.bank.example';
const API = 'https://api.bank.example';
const REDIRECT = 'https://store.example/callback';
const CLIENT = 'example-store';
const BG_CLIENT = 'PSDES-BDE-3DFD21';
export const PAYMENT_ID = '1234-wertiq-983';
const NEW_PAYMENT_ID = '7731-qzhpre-120';

const PKCE = {
  verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
};
const STATE = 'af0ifjsldkj';
const CODE = 'SplxlOBeZQQYbYS6WxSbIA';
const REQUEST_URI = 'urn:ietf:params:oauth:request_uri:6esc_11ACC5bwc014ltc14eY22c';
const CLIENT_ASSERTION = 'eyJhbGciOiJQUzI1NiIsImtpZCI6InN0b3JlLTIwMjYifQ.eyJpc3MiOiJleGFtcGxlLXN0b3JlIi…';
const DPOP_PROOF = 'eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7Imt0eSI6IkVDIi…';
const DPOP_TOKEN = 'Kz~8mXK1EalYznwH-LC-1fBAo.4Ljp~zsPE_NeO.gxU';
const BEARER_TOKEN = 'SlAV32hkKG';

const amount = (value: string) => ({ currency: CURRENCY, amount: value });

export const DETAILS = [
  {
    type: 'payment_initiation',
    actions: ['initiate', 'status'],
    locations: [`${API}/payments`],
    instructedAmount: amount(PAYMENT.amount),
    creditorName: PAYMENT.creditorName,
    creditorAccount: { iban: PAYMENT.creditorIban },
    remittanceInformationUnstructured: PAYMENT.reference,
  },
];

const transfer = (target: Transfer) => ({
  instructedAmount: amount(target.amount),
  debtorAccount: { iban: DEBTOR_IBAN },
  creditorName: target.creditorName,
  creditorAccount: { iban: target.creditorIban },
  remittanceInformationUnstructured: target.reference,
});

const clientAuth = {
  client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  client_assertion: CLIENT_ASSERTION,
};

const dpop = { Authorization: `DPoP ${DPOP_TOKEN}`, DPoP: DPOP_PROOF };

const paymentLines = [
  { label: 'Amount', value: `${PAYMENT.amount} ${CURRENCY}` },
  { label: 'To', value: `${PAYMENT.creditorName}, ${PAYMENT.creditorIban}` },
  { label: 'Reference', value: PAYMENT.reference },
  { label: 'From', value: DEBTOR_IBAN },
];

function pay(target: Transfer, status: number, response: object): Call {
  return { step: 'pay', method: 'POST', url: `${API}/payments`, headers: dpop, body: transfer(target), status, response };
}

/** Authorization code flow under the FAPI 2.0 Security Profile: PAR, PKCE, private_key_jwt, iss and DPoP. */
function fapiCalls(request: Record<string, string>, token: object): Call[] {
  return [
    {
      step: 'par',
      method: 'POST',
      url: `${AS}/par`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form: {
        response_type: 'code',
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        ...request,
        state: STATE,
        code_challenge: PKCE.challenge,
        code_challenge_method: 'S256',
        ...clientAuth,
      },
      status: 201,
      response: { request_uri: REQUEST_URI, expires_in: 60 },
    },
    {
      step: 'authorize',
      method: 'GET',
      url: `${AS}/authorize?client_id=${CLIENT}&request_uri=${encodeURIComponent(REQUEST_URI)}`,
      status: 200,
    },
    {
      step: 'approve',
      method: 'GET',
      url: `${REDIRECT}?code=${CODE}&state=${STATE}&iss=${encodeURIComponent(AS)}`,
      status: 200,
    },
    {
      step: 'token',
      method: 'POST',
      url: `${AS}/token`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: DPOP_PROOF },
      form: { grant_type: 'authorization_code', code: CODE, redirect_uri: REDIRECT, code_verifier: PKCE.verifier, ...clientAuth },
      status: 200,
      response: token,
    },
    pay(PAYMENT, 201, { paymentId: 'pay-5541', status: 'accepted' }),
  ];
}

function scopeScenario(): Scenario {
  const token = { access_token: DPOP_TOKEN, token_type: 'DPoP', expires_in: 300, scope: 'payments' };
  return {
    approach: 'scope',
    calls: fapiCalls({ scope: 'payments' }, token),
    consent: [{ label: 'Access', value: 'Make payments from your accounts' }],
    token,
    misuse: { call: pay(OTHER, 201, { paymentId: 'pay-5542', status: 'accepted' }), outcome: 'accepted' },
  };
}

function psd2Scenario(): Scenario {
  const paymentPath = `${API}/psd2/v1/payments/sepa-credit-transfers`;
  const create = (id: string, target: Transfer): Call => ({
    step: 'createPayment',
    method: 'POST',
    url: paymentPath,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': '99391c7e-ad88-49ec-a2ad-99ddcb1f7721', 'PSU-IP-Address': '192.168.8.78' },
    body: transfer(target),
    status: 201,
    responseHeaders: { 'ASPSP-SCA-Approach': 'REDIRECT', Location: `${paymentPath}/${id}` },
    response: {
      transactionStatus: 'RCVD',
      paymentId: id,
      _links: {
        scaOAuth: { href: `${AS}/.well-known/oauth-authorization-server` },
        self: { href: `/psd2/v1/payments/sepa-credit-transfers/${id}` },
        status: { href: `/psd2/v1/payments/sepa-credit-transfers/${id}/status` },
      },
    },
  });
  const token = { access_token: BEARER_TOKEN, token_type: 'Bearer', expires_in: 3600, scope: `PIS:${PAYMENT_ID}` };
  const query = [
    'response_type=code',
    `client_id=${BG_CLIENT}`,
    `scope=PIS:${PAYMENT_ID}`,
    `state=${STATE}`,
    `redirect_uri=${encodeURIComponent(REDIRECT)}`,
    'code_challenge_method=S256',
    `code_challenge=${PKCE.challenge}`,
  ].join('&');

  return {
    approach: 'psd2',
    calls: [
      create(PAYMENT_ID, PAYMENT),
      { step: 'authorize', method: 'GET', url: `${AS}/authorise?${query}`, status: 200 },
      { step: 'approve', method: 'GET', url: `${REDIRECT}?code=${CODE}&state=${STATE}`, status: 200 },
      {
        step: 'token',
        method: 'POST',
        url: `${AS}/token`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        form: { client_id: BG_CLIENT, grant_type: 'authorization_code', code: CODE, redirect_uri: REDIRECT, code_verifier: PKCE.verifier },
        status: 200,
        response: token,
      },
      {
        step: 'status',
        method: 'GET',
        url: `${paymentPath}/${PAYMENT_ID}/status`,
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
        status: 200,
        response: { transactionStatus: 'ACTC' },
      },
    ],
    consent: paymentLines,
    token,
    misuse: { call: create(NEW_PAYMENT_ID, OTHER), outcome: 'newApproval' },
  };
}

function rarScenario(): Scenario {
  const token = { access_token: DPOP_TOKEN, token_type: 'DPoP', expires_in: 300, authorization_details: DETAILS };
  return {
    approach: 'rar',
    calls: fapiCalls({ authorization_details: JSON.stringify(DETAILS) }, token),
    consent: [...paymentLines, { label: 'Also', value: 'Check the status of this payment' }],
    token,
    misuse: {
      call: pay(OTHER, 403, {
        error: 'payment_not_authorized',
        error_description: 'The amount and the payee do not match the authorization_details of the token.',
      }),
      outcome: 'rejected',
    },
  };
}

export function scenario(approach: Approach): Scenario {
  if (approach === 'scope') return scopeScenario();
  if (approach === 'psd2') return psd2Scenario();
  return rarScenario();
}

const formValue = (key: string, value: string) =>
  key === 'authorization_details' ? JSON.stringify(JSON.parse(value), null, 2) : value;

/** The request as it travels, with form fields one per line and decoded so they can be read. */
export function requestText(call: Call) {
  const url = new URL(call.url);
  const lines = [`${call.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`];
  for (const [key, value] of Object.entries(call.headers ?? {})) lines.push(`${key}: ${value}`);
  if (call.form) lines.push('', Object.entries(call.form).map(([key, value]) => `${key}=${formValue(key, value)}`).join('\n&'));
  else if (call.body) lines.push('', json(call.body));
  return lines.join('\n');
}

export function responseText(call: Call, reason = '') {
  const lines = [`HTTP/1.1 ${call.status} ${reason}`.trim()];
  for (const [key, value] of Object.entries(call.responseHeaders ?? {})) lines.push(`${key}: ${value}`);
  if (call.response) lines.push('', json(call.response));
  return lines.join('\n');
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
