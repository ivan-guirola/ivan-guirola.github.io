import { describe, expect, it } from 'vitest';
import { APPROACHES, DETAILS, OTHER, PAYMENT, PAYMENT_ID, requestText, responseText, scenario } from './payment';

const steps = (approach: (typeof APPROACHES)[number]) => scenario(approach).calls.map((call) => call.step);

describe('scenario', () => {
  it('uses PAR, then the authorization code, then the payment under FAPI 2.0', () => {
    for (const approach of ['scope', 'rar'] as const) {
      expect(steps(approach)).toEqual(['par', 'authorize', 'approve', 'token', 'pay']);
      const [par, authorize, approve, token] = scenario(approach).calls;
      expect(par.form).toMatchObject({ response_type: 'code', code_challenge_method: 'S256', client_assertion_type: expect.stringContaining('jwt-bearer') });
      expect((par.response as { expires_in: number }).expires_in).toBeLessThan(600);
      expect(new URL(authorize.url).searchParams.get('request_uri')).toMatch(/^urn:ietf:params:oauth:request_uri:/);
      expect([...new URL(authorize.url).searchParams.keys()]).toEqual(['client_id', 'request_uri']);
      expect(new URL(approve.url).searchParams.get('iss')).toBe('https://auth.bank.example');
      expect(token.headers).toHaveProperty('DPoP');
      expect(token.response).toMatchObject({ token_type: 'DPoP' });
    }
  });

  it('asks only for a scope, or only for authorization details', () => {
    const scope = scenario('scope').calls[0].form!;
    expect(scope.scope).toBe('payments');
    expect(scope).not.toHaveProperty('authorization_details');
    const rar = scenario('rar').calls[0].form!;
    expect(rar).not.toHaveProperty('scope');
    expect(JSON.parse(rar.authorization_details)).toEqual(DETAILS);
  });

  it('returns the granted authorization details with the RAR token', () => {
    expect(scenario('rar').token.authorization_details).toEqual(DETAILS);
    expect(scenario('scope').token).not.toHaveProperty('authorization_details');
  });

  it('creates the payment before sign-in in Berlin Group and points the scope at it', () => {
    const { calls, token } = scenario('psd2');
    expect(calls.map((call) => call.step)).toEqual(['createPayment', 'authorize', 'approve', 'token', 'status']);
    expect(calls[0].response).toMatchObject({ transactionStatus: 'RCVD', paymentId: PAYMENT_ID });
    expect(new URL(calls[1].url).searchParams.get('scope')).toBe(`PIS:${PAYMENT_ID}`);
    expect(token).toMatchObject({ token_type: 'Bearer', scope: `PIS:${PAYMENT_ID}` });
  });

  it('shows the amount and payee on the consent screen only when the bank knows them', () => {
    const text = (approach: (typeof APPROACHES)[number]) => scenario(approach).consent.map((line) => line.value).join(' ');
    expect(text('scope')).not.toContain(PAYMENT.amount);
    for (const approach of ['psd2', 'rar'] as const) {
      expect(text(approach)).toContain(PAYMENT.amount);
      expect(text(approach)).toContain(PAYMENT.creditorIban);
    }
  });

  it('limits a different payment differently in each approach', () => {
    expect(scenario('scope').misuse).toMatchObject({ outcome: 'accepted', call: { status: 201 } });
    expect(scenario('psd2').misuse).toMatchObject({ outcome: 'newApproval', call: { step: 'createPayment', response: { transactionStatus: 'RCVD' } } });
    expect(scenario('rar').misuse).toMatchObject({ outcome: 'rejected', call: { status: 403 } });
    for (const approach of APPROACHES) {
      expect(scenario(approach).misuse.call.body).toMatchObject({ instructedAmount: { amount: OTHER.amount }, creditorAccount: { iban: OTHER.creditorIban } });
    }
  });

  it('pays exactly what was approved', () => {
    for (const approach of ['scope', 'rar'] as const) {
      const pay = scenario(approach).calls.at(-1)!;
      expect(pay.body).toMatchObject({ instructedAmount: DETAILS[0].instructedAmount, creditorAccount: DETAILS[0].creditorAccount });
    }
  });
});

describe('requestText', () => {
  it('writes the request line, host, headers and decoded form fields', () => {
    const text = requestText(scenario('rar').calls[0]);
    expect(text.split('\n').slice(0, 3)).toEqual(['POST /par HTTP/1.1', 'Host: auth.bank.example', 'Content-Type: application/x-www-form-urlencoded']);
    expect(text).toContain('&authorization_details=[\n  {\n    "type": "payment_initiation"');
  });

  it('writes a JSON body after a blank line', () => {
    expect(requestText(scenario('psd2').calls[0])).toMatch(/PSU-IP-Address: [\d.]+\n\n\{\n {2}"instructedAmount"/);
  });
});

describe('responseText', () => {
  it('writes the status, headers and body', () => {
    const text = responseText(scenario('psd2').calls[0], 'Created');
    expect(text).toMatch(/^HTTP\/1.1 201 Created\nASPSP-SCA-Approach: REDIRECT\n/);
    expect(text).toContain('"transactionStatus": "RCVD"');
  });
});
