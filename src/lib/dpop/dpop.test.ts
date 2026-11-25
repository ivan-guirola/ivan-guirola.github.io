import { describe, expect, it } from 'vitest';
import { decodeJwt, sha256, thumbprint, verifyJwt } from '../jose';
import { requestText, startDpop, type Mode } from './dpop';

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);

async function ready(mode: Mode) {
  const session = await startDpop(mode, NOW);
  await session.getToken();
  const { call } = await session.callApi();
  return { session, call };
}

const failed = (checks: { field: string; ok: boolean }[]) => checks.filter((check) => !check.ok).map((check) => check.field);

describe('getting the token', () => {
  it('binds a DPoP token to the thumbprint of the key in the proof', async () => {
    const session = await startDpop('dpop', NOW);
    const call = await session.getToken();
    const proof = decodeJwt(call.headers.DPoP);
    expect(proof.header).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256', jwk: session.appKey });
    expect(proof.header.kid).toBeUndefined();
    expect(proof.payload).toMatchObject({ htm: 'POST', htu: 'https://auth.bank.example/token' });
    expect(proof.payload.ath).toBeUndefined();
    expect(await verifyJwt(call.headers.DPoP, { ...session.appKey, kid: '' })).toBe(true);
    expect(session.claims!.payload.cnf).toEqual({ jkt: await thumbprint(session.appKey) });
    expect(call.response).toMatchObject({ token_type: 'DPoP' });
  });

  it('gives a plain bearer token without a proof', async () => {
    const session = await startDpop('bearer', NOW);
    const call = await session.getToken();
    expect(call.headers.DPoP).toBeUndefined();
    expect(session.claims!.payload.cnf).toBeUndefined();
    expect(call.response).toMatchObject({ token_type: 'Bearer' });
  });

  it('cannot call the API without a token', async () => {
    const session = await startDpop('dpop', NOW);
    await expect(session.callApi()).rejects.toThrow('token first');
    await expect(session.steal('token')).rejects.toThrow('not used');
  });
});

describe('the app calling the API', () => {
  it('sends a fresh proof tied to the method, the URL and the token', async () => {
    const { session, call } = await ready('dpop');
    expect(call.headers.Authorization).toBe(`DPoP ${session.token}`);
    const proof = decodeJwt(call.headers.DPoP).payload;
    expect(proof).toMatchObject({ htm: 'GET', htu: 'https://api.bank.example/accounts', ath: await sha256(session.token!) });
    expect(call.status).toBe(200);
  });

  it('passes every check', async () => {
    const session = await startDpop('dpop', NOW);
    await session.getToken();
    const attempt = await session.callApi();
    expect(attempt.accepted).toBe(true);
    expect(attempt.checks.map((check) => check.field)).toEqual([
      'signature',
      'expiry',
      'scheme',
      'proof',
      'proofSignature',
      'key',
      'method',
      'url',
      'tokenHash',
      'fresh',
      'unique',
    ]);
  });

  it('renders the request with both headers', async () => {
    const { call } = await ready('dpop');
    expect(requestText(call)).toMatch(/^GET \/accounts HTTP\/1.1\nHost: api.bank.example\nAuthorization: DPoP .+\nDPoP: ey/);
  });
});

describe('a stolen bearer token', () => {
  it('works for the attacker, anywhere', async () => {
    const { session } = await ready('bearer');
    expect((await session.steal('token')).accepted).toBe(true);
    const transfer = await session.steal('otherEndpoint');
    expect(transfer.accepted).toBe(true);
    expect(transfer.call.status).toBe(201);
  });
});

describe('a stolen DPoP token', () => {
  it('is rejected on its own', async () => {
    const { session } = await ready('dpop');
    const attempt = await session.steal('token');
    expect(failed(attempt.checks)).toEqual(['scheme', 'proof']);
    expect(attempt.call.responseHeaders!['WWW-Authenticate']).toContain('invalid_token');
  });

  it('is rejected with a proof signed by another key', async () => {
    const { session } = await ready('dpop');
    const attempt = await session.steal('ownKey');
    expect(failed(attempt.checks)).toEqual(['key']);
    expect(attempt.checks.find((check) => check.field === 'key')).toMatchObject({
      expected: session.appThumbprint,
      actual: session.attackerThumbprint,
    });
    expect(attempt.call.responseHeaders!['WWW-Authenticate']).toContain('invalid_dpop_proof');
  });

  it('is rejected when the app’s proof is replayed', async () => {
    const { session } = await ready('dpop');
    expect(failed((await session.steal('replay')).checks)).toEqual(['unique']);
  });

  it('is rejected when the proof is used for another call', async () => {
    const { session } = await ready('dpop');
    expect(failed((await session.steal('otherEndpoint')).checks)).toEqual(['method', 'url', 'unique']);
  });
});
