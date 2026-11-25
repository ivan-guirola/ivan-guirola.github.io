import { describe, expect, it } from 'vitest';
import { decodeJwt, verifyJwt } from '../jose';
import { DEFAULT_INPUT, nextFriday, requestText, startSession, type CaseId, type Mode } from './exact';

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);

async function approved(caseId: CaseId, mode: Mode, input = DEFAULT_INPUT) {
  const session = await startSession(caseId, mode, input, NOW);
  await session.approve();
  return session;
}

const failed = (checks: { field: string; ok: boolean }[]) => checks.filter((check) => !check.ok).map((check) => check.field);

describe('the request', () => {
  it('pushes authorization_details with PKCE and a signed client assertion', async () => {
    const session = await startSession('payment', 'rar', DEFAULT_INPUT, NOW);
    const par = session.calls[0];
    expect(par.step).toBe('par');
    expect(par.form).not.toHaveProperty('scope');
    expect(JSON.parse(par.form!.authorization_details)[0]).toMatchObject({
      type: 'payment_initiation',
      instructedAmount: { currency: 'EUR', amount: '45.00' },
      creditorAccount: { iban: 'DE02100100109307118603' },
    });
    expect(par.form!.code_challenge_method).toBe('S256');
    expect(await verifyJwt(par.form!.client_assertion, session.clientKey)).toBe(true);
    expect(session.calls[1].url).toContain('request_uri=');
    expect(session.calls[1].url).not.toContain('authorization_details');
  });

  it('asks only for a scope in scope mode', async () => {
    const session = await startSession('agent', 'scope', DEFAULT_INPUT, NOW);
    expect(session.calls[0].form).toMatchObject({ scope: 'bookings' });
    expect(session.details).toBeUndefined();
  });

  it('uses what the person typed', async () => {
    const session = await startSession('agent', 'rar', { ...DEFAULT_INPUT, destination: 'OPO', maxPrice: '250.00' }, NOW);
    expect(session.details![0]).toMatchObject({ destination: 'OPO', maxPrice: { amount: '250.00' }, departBy: '2026-11-27' });
  });

  it('renders the pushed request with readable authorization_details', async () => {
    const session = await startSession('payment', 'rar', DEFAULT_INPUT, NOW);
    const text = requestText(session.calls[0]);
    expect(text).toMatch(/^POST \/par HTTP\/1.1\nHost: auth.bank.example/);
    expect(text).toContain('"type": "payment_initiation"');
  });
});

describe('the token', () => {
  it('is a JWT signed by the server that carries the details', async () => {
    const session = await approved('payment', 'rar');
    expect(await verifyJwt(session.token!, session.serverKey)).toBe(true);
    const { header, payload } = decodeJwt(session.token!);
    expect(header).toMatchObject({ typ: 'at+jwt', alg: 'ES256' });
    expect(payload).toMatchObject({ aud: 'https://api.bank.example', client_id: 'example-store', authorization_details: session.details });
    expect(payload.scope).toBeUndefined();
    expect(session.calls.map((call) => call.step)).toEqual(['par', 'authorize', 'callback', 'token']);
  });

  it('carries only the scope in scope mode', async () => {
    const { claims } = await approved('payment', 'scope');
    expect(claims!.payload).toMatchObject({ scope: 'payments' });
    expect(claims!.payload.authorization_details).toBeUndefined();
  });

  it('cannot be used before approval', async () => {
    const session = await startSession('payment', 'rar', DEFAULT_INPUT, NOW);
    await expect(session.attempt('agreed')).rejects.toThrow('approve');
  });
});

describe('payments', () => {
  it('a scope lets the store make any payment, as often as it wants', async () => {
    const session = await approved('payment', 'scope');
    for (const id of ['agreed', 'amount', 'payee', 'again']) {
      const attempt = await session.attempt(id);
      expect(attempt.accepted, id).toBe(true);
      expect(attempt.call.status).toBe(201);
    }
  });

  it('RAR allows the agreed payment once', async () => {
    const session = await approved('payment', 'rar');
    expect((await session.attempt('agreed')).accepted).toBe(true);
    const again = await session.attempt('again');
    expect(again.accepted).toBe(false);
    expect(failed(again.checks)).toEqual(['once']);
  });

  it('RAR rejects another amount or another payee', async () => {
    const session = await approved('payment', 'rar');
    const amount = await session.attempt('amount');
    expect(failed(amount.checks)).toEqual(['amount']);
    expect(amount.checks.find((check) => check.field === 'amount')).toMatchObject({ allowed: '45.00', requested: '450.00' });
    expect(amount.call.status).toBe(403);
    expect(failed((await session.attempt('payee')).checks)).toEqual(['amount', 'payee', 'payeeName']);
  });

  it('a rejected attempt does not use up the permission', async () => {
    const session = await approved('payment', 'rar');
    await session.attempt('payee');
    expect((await session.attempt('agreed')).accepted).toBe(true);
  });
});

describe('an AI agent booking a flight', () => {
  it('RAR allows the flight within the limits', async () => {
    const session = await approved('agent', 'rar');
    const attempt = await session.attempt('agreed');
    expect(attempt.accepted).toBe(true);
    expect(attempt.checks.find((check) => check.field === 'price')).toMatchObject({ allowed: 'up to 300.00', requested: '289.00', ok: true });
  });

  it('RAR rejects business class, another destination and a hotel', async () => {
    const session = await approved('agent', 'rar');
    expect(failed((await session.attempt('business')).checks)).toEqual(['cabin', 'price']);
    expect(failed((await session.attempt('elsewhere')).checks)).toEqual(['destination', 'price']);
    expect(failed((await session.attempt('hotel')).checks)).toEqual(['location']);
  });

  it('RAR rejects the flight when it costs more than the limit', async () => {
    const session = await approved('agent', 'rar', { ...DEFAULT_INPUT, maxPrice: '250.00' });
    expect(failed((await session.attempt('agreed')).checks)).toEqual(['price']);
  });

  it('a scope lets the agent book anything', async () => {
    const session = await approved('agent', 'scope');
    for (const id of ['agreed', 'business', 'elsewhere', 'hotel', 'again']) expect((await session.attempt(id)).accepted, id).toBe(true);
  });
});

describe('nextFriday', () => {
  it('returns the coming Friday, and the one after on a Friday', () => {
    expect(nextFriday(Date.UTC(2026, 10, 25))).toBe('2026-11-27');
    expect(nextFriday(Date.UTC(2026, 10, 27))).toBe('2026-12-04');
  });
});
