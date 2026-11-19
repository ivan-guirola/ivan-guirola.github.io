import { describe, expect, it } from 'vitest';
import { decodeJwt, inspectJwt } from './jwt';
import { toBase64Url } from '../webauthn/bytes';

const part = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
const token = (header: object, payload: object, signature = 'c2ln') => `${part(header)}.${part(payload)}.${signature}`;
const NOW = 1_800_000_000;

describe('decodeJwt', () => {
  it('returns the header, the payload and the signature', () => {
    const jwt = decodeJwt(token({ alg: 'RS256', typ: 'JWT' }, { sub: 'ana', name: 'Ana García' }));
    expect(jwt.header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(jwt.payload).toEqual({ sub: 'ana', name: 'Ana García' });
    expect(jwt.signature).toBe('c2ln');
  });

  it('rejects text that does not have three parts', () => {
    expect(() => decodeJwt('abc.def')).toThrow(/JWT/);
  });

  it('rejects parts that are not JSON objects', () => {
    expect(() => decodeJwt(`${part([1])}.${part({})}.x`)).toThrow(/JWT/);
    expect(() => decodeJwt('bm9wZQ.bm9wZQ.x')).toThrow(/JWT/);
  });
});

describe('inspectJwt', () => {
  const inspect = (payload: object, header: object = { alg: 'ES256' }, signature?: string) =>
    inspectJwt(decodeJwt(token(header, payload, signature)), NOW);

  it('reads the standard claims', () => {
    const info = inspect({ iss: 'https://idp.test', sub: 'ana', aud: 'app', iat: NOW - 60, exp: NOW + 600 });
    expect(info).toMatchObject({
      algorithm: 'ES256',
      issuer: 'https://idp.test',
      subject: 'ana',
      audience: ['app'],
      issuedAt: NOW - 60,
      expiresAt: NOW + 600,
      status: 'valid',
      unsigned: false,
    });
  });

  it('accepts a list of audiences', () => {
    expect(inspect({ aud: ['a', 'b'] }).audience).toEqual(['a', 'b']);
  });

  it('marks a token past its expiry as expired', () => {
    expect(inspect({ exp: NOW - 1 }).status).toBe('expired');
  });

  it('marks a token before its start time as not yet valid', () => {
    expect(inspect({ nbf: NOW + 30, exp: NOW + 600 }).status).toBe('notYetValid');
  });

  it('reports when there is no expiry', () => {
    expect(inspect({ sub: 'ana' }).status).toBe('noExpiry');
  });

  it('flags tokens without a signature', () => {
    expect(inspect({}, { alg: 'none' }, '').unsigned).toBe(true);
    expect(inspect({}, { alg: 'RS256' }, '').unsigned).toBe(true);
  });

  it('ignores claims of the wrong type', () => {
    const info = inspect({ iss: 5, exp: 'tomorrow', aud: [1, 'app'] });
    expect(info.issuer).toBeUndefined();
    expect(info.expiresAt).toBeUndefined();
    expect(info.audience).toEqual(['app']);
  });
});
