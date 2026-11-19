import { describe, expect, it } from 'vitest';
import { coseToJwk, derToRaw, parseAuthenticatorData } from './authdata';
import { concat } from './bytes';
import { FLAG, createFakeAuthenticator, rawToDer } from './fake-authenticator';
import { decodeCbor } from './cbor';

const rp = { rpId: 'example.test', origin: 'https://example.test' };

async function registrationAuthData(flags?: number) {
  const fake = await createFakeAuthenticator({ ...rp, flags });
  const created = await fake.create({ challenge: new Uint8Array(32) });
  const attestation = decodeCbor(new Uint8Array(created.response.attestationObject)).value as Map<string, unknown>;
  return { fake, authData: attestation.get('authData') as Uint8Array };
}

describe('parseAuthenticatorData', () => {
  it('reads the RP ID hash, counter and flags of an assertion', async () => {
    const fake = await createFakeAuthenticator({ ...rp, flags: FLAG.UP | FLAG.BE | FLAG.BS });
    const assertion = await fake.get({ challenge: new Uint8Array(32) });
    const parsed = parseAuthenticatorData(new Uint8Array(assertion.response.authenticatorData));

    expect(parsed.rpIdHash).toHaveLength(32);
    expect(parsed.signCount).toBe(1);
    expect(parsed.flags).toEqual({
      userPresent: true,
      userVerified: false,
      backupEligible: true,
      backupState: true,
      attestedCredentialData: false,
      extensionData: false,
    });
    expect(parsed.credential).toBeUndefined();
  });

  it('reads the attested credential of a registration', async () => {
    const { fake, authData } = await registrationAuthData();
    const parsed = parseAuthenticatorData(authData);

    expect(parsed.flags.attestedCredentialData).toBe(true);
    expect(parsed.flags.userVerified).toBe(true);
    expect(parsed.credential?.credentialId).toEqual(fake.credentialId);
    expect(parsed.credential?.aaguid).toBe('a0a1a2a3-a4a5-a6a7-a8a9-aaabacadaeaf');
    expect(parsed.credential?.cose.get(3)).toBe(-7);
  });

  it('rejects data shorter than the fixed 37-byte header', () => {
    expect(() => parseAuthenticatorData(new Uint8Array(36))).toThrow(/too short/i);
  });

  it('rejects a registration whose credential data is cut off', async () => {
    const { authData } = await registrationAuthData();
    expect(() => parseAuthenticatorData(authData.slice(0, 60))).toThrow();
  });
});

describe('coseToJwk', () => {
  it('converts an ES256 key', async () => {
    const { fake, authData } = await registrationAuthData();
    const key = coseToJwk(parseAuthenticatorData(authData).credential!.cose);
    expect(key).toEqual({ alg: -7, name: 'ES256', jwk: { kty: 'EC', crv: 'P-256', x: fake.jwk.x, y: fake.jwk.y } });
  });

  it('converts an RS256 key', async () => {
    const fake = await createFakeAuthenticator({ ...rp, alg: -257 });
    const created = await fake.create({ challenge: new Uint8Array(32) });
    const attestation = decodeCbor(new Uint8Array(created.response.attestationObject)).value as Map<string, unknown>;
    const key = coseToJwk(parseAuthenticatorData(attestation.get('authData') as Uint8Array).credential!.cose);
    expect(key).toEqual({ alg: -257, name: 'RS256', jwk: { kty: 'RSA', alg: 'RS256', n: fake.jwk.n, e: fake.jwk.e } });
  });

  it('rejects key types the demo does not handle', () => {
    expect(() =>
      coseToJwk(
        new Map<number, unknown>([
          [1, 1],
          [3, -8],
        ]),
      ),
    ).toThrow(/unsupported/i);
  });
});

describe('derToRaw', () => {
  it('pads short integers and drops the sign byte', () => {
    const r = concat(new Uint8Array([0x80]), new Uint8Array(31).fill(1));
    const s = concat(new Uint8Array(2), new Uint8Array(30).fill(2));
    const raw = concat(r, s);
    expect(derToRaw(rawToDer(raw), 32)).toEqual(raw);
  });

  it('rejects input that is not a DER signature', () => {
    expect(() => derToRaw(new Uint8Array([0x31, 0x00]), 32)).toThrow(/DER/);
  });
});
