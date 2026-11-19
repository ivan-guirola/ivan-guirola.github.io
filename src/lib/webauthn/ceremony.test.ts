import { describe, expect, it } from 'vitest';
import { creationOptions, readRegistration, requestOptions, verifyAssertion } from './ceremony';
import { fromBase64Url, toBase64Url } from './bytes';
import { FLAG, createFakeAuthenticator } from './fake-authenticator';

const rp = { rpId: 'example.test', origin: 'https://example.test' };
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

async function registered(alg: -7 | -257 = -7, flags?: number) {
  const fake = await createFakeAuthenticator({ ...rp, alg, flags });
  const registration = readRegistration(await fake.create({ challenge: challenge() }));
  return { fake, registration };
}

async function verify(alg: -7 | -257, tamper: Parameters<Awaited<ReturnType<typeof createFakeAuthenticator>>['get']>[1] = {}) {
  const { fake, registration } = await registered(alg);
  const expected = challenge();
  const credential = await fake.get({ challenge: expected }, tamper);
  return verifyAssertion({ credential, registration, challenge: expected, ...rp });
}

const failed = (result: Awaited<ReturnType<typeof verifyAssertion>>) => result.checks.filter((c) => !c.ok).map((c) => c.id);

describe('creationOptions', () => {
  it('asks for ES256 and RS256, no attestation, and the chosen authenticator behaviour', () => {
    const options = creationOptions({
      rpId: 'example.test',
      rpName: 'Demo',
      userName: 'ivan',
      userId: new Uint8Array(16),
      challenge: new Uint8Array(32),
      residentKey: 'required',
      userVerification: 'discouraged',
    });
    expect(options.rp).toEqual({ id: 'example.test', name: 'Demo' });
    expect(options.user).toMatchObject({ name: 'ivan', displayName: 'ivan' });
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(options.attestation).toBe('none');
    expect(options.authenticatorSelection).toEqual({ residentKey: 'required', requireResidentKey: true, userVerification: 'discouraged' });
  });
});

describe('requestOptions', () => {
  it('targets the stored credential on the same RP', () => {
    const id = toBase64Url(new Uint8Array([1, 2, 3]));
    const options = requestOptions({ rpId: 'example.test', credentialId: id, challenge: new Uint8Array(32), userVerification: 'preferred' });
    expect(options.rpId).toBe('example.test');
    expect(options.userVerification).toBe('preferred');
    expect(options.allowCredentials).toEqual([{ type: 'public-key', id: fromBase64Url(id) }]);
  });
});

describe('readRegistration', () => {
  it('extracts what the authenticator returned for an ES256 passkey', async () => {
    const { fake, registration } = await registered(-7, FLAG.UP | FLAG.UV | FLAG.BE);
    expect(registration).toMatchObject({
      credentialId: toBase64Url(fake.credentialId),
      aaguid: 'a0a1a2a3-a4a5-a6a7-a8a9-aaabacadaeaf',
      alg: -7,
      algName: 'ES256',
      signCount: 1,
      transports: ['internal', 'hybrid'],
      attachment: 'platform',
    });
    expect(registration.jwk).toMatchObject({ kty: 'EC', crv: 'P-256', x: fake.jwk.x, y: fake.jwk.y });
    expect(registration.flags).toMatchObject({ userPresent: true, userVerified: true, backupEligible: true, backupState: false });
  });

  it('extracts an RS256 passkey', async () => {
    const { registration } = await registered(-257);
    expect(registration.algName).toBe('RS256');
    expect(registration.jwk.kty).toBe('RSA');
  });

  it('survives a JSON round trip, as it is kept in localStorage', async () => {
    const { registration } = await registered();
    expect(JSON.parse(JSON.stringify(registration))).toEqual(registration);
  });

  it('rejects a response without attested credential data', async () => {
    const fake = await createFakeAuthenticator(rp);
    const created = await fake.create({ challenge: challenge() });
    const assertion = await fake.get({ challenge: challenge() });
    const { encodeCbor } = await import('./fake-authenticator');
    const broken = encodeCbor(
      new Map<string, never>([
        ['fmt', 'none' as never],
        ['attStmt', new Map() as never],
        ['authData', new Uint8Array(assertion.response.authenticatorData) as never],
      ]),
    );
    expect(() => readRegistration({ ...created, response: { ...created.response, attestationObject: broken.buffer } })).toThrow(/credential/i);
  });
});

describe('verifyAssertion', () => {
  it.each([[-7 as const], [-257 as const]])('accepts a genuine assertion (alg %i)', async (alg) => {
    const result = await verify(alg);
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.id)).toEqual(['type', 'challenge', 'origin', 'rpId', 'userPresent', 'signature']);
    expect(failed(result)).toEqual([]);
    expect(result.signCount).toBe(2);
  });

  it('fails only the challenge check when the challenge is not the one issued', async () => {
    const { fake, registration } = await registered();
    const credential = await fake.get({ challenge: challenge() });
    const result = await verifyAssertion({ credential, registration, challenge: challenge(), ...rp });
    expect(result.ok).toBe(false);
    expect(failed(result)).toEqual(['challenge']);
  });

  it('fails the origin check for a response produced on another site', async () => {
    expect(failed(await verify(-7, { origin: 'https://evil.test' }))).toEqual(['origin']);
  });

  it('fails the RP ID check when the authenticator data is bound to another RP', async () => {
    expect(failed(await verify(-7, { rpId: 'evil.test' }))).toEqual(['rpId']);
  });

  it('fails the type check for a registration response replayed as a login', async () => {
    expect(failed(await verify(-7, { type: 'webauthn.create' }))).toEqual(['type']);
  });

  it('fails the user-presence check when the flag is not set', async () => {
    expect(failed(await verify(-7, { flags: FLAG.UV }))).toEqual(['userPresent']);
  });

  it.each([[-7 as const], [-257 as const]])('fails the signature check when the signed data was altered (alg %i)', async (alg) => {
    const { fake, registration } = await registered(alg);
    const expected = challenge();
    const credential = await fake.get({ challenge: expected });
    const authenticatorData = new Uint8Array(credential.response.authenticatorData);
    authenticatorData[36] ^= 0x01;
    const result = await verifyAssertion({
      credential: { ...credential, response: { ...credential.response, authenticatorData: authenticatorData.buffer } },
      registration,
      challenge: expected,
      ...rp,
    });
    expect(failed(result)).toEqual(['signature']);
  });

  it('fails the signature check, without throwing, when the signature is garbage', async () => {
    const { fake, registration } = await registered();
    const expected = challenge();
    const credential = await fake.get({ challenge: expected });
    const result = await verifyAssertion({
      credential: { ...credential, response: { ...credential.response, signature: new Uint8Array([1, 2, 3]).buffer } },
      registration,
      challenge: expected,
      ...rp,
    });
    expect(failed(result)).toEqual(['signature']);
  });

  it('fails the signature check against a different passkey', async () => {
    const { fake } = await registered();
    const other = await registered();
    const expected = challenge();
    const credential = await fake.get({ challenge: expected });
    const result = await verifyAssertion({ credential, registration: other.registration, challenge: expected, ...rp });
    expect(failed(result)).toEqual(['signature']);
  });
});
