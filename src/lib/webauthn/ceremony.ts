import { coseToJwk, derToRaw, parseAuthenticatorData, type AuthenticatorFlags } from './authdata';
import { concat, equalBytes, fromBase64Url, toBase64Url, toBytes } from './bytes';
import { decodeCbor } from './cbor';

type Preference = 'required' | 'preferred' | 'discouraged';

export interface Registration {
  credentialId: string;
  aaguid: string;
  alg: -7 | -257;
  algName: 'ES256' | 'RS256';
  jwk: JsonWebKey;
  flags: AuthenticatorFlags;
  signCount: number;
  transports: string[];
  attachment: string | null;
}

export interface CreationInput {
  rpId: string;
  rpName: string;
  userName: string;
  userId: Uint8Array;
  challenge: Uint8Array;
  residentKey: Preference;
  userVerification: Preference;
}

export function creationOptions(input: CreationInput) {
  return {
    rp: { id: input.rpId, name: input.rpName },
    user: { id: input.userId, name: input.userName, displayName: input.userName },
    challenge: input.challenge,
    pubKeyCredParams: [
      { type: 'public-key' as const, alg: -7 },
      { type: 'public-key' as const, alg: -257 },
    ],
    attestation: 'none' as const,
    authenticatorSelection: {
      residentKey: input.residentKey,
      requireResidentKey: input.residentKey === 'required',
      userVerification: input.userVerification,
    },
    timeout: 120_000,
  };
}

export interface RequestInput {
  rpId: string;
  credentialId: string;
  challenge: Uint8Array;
  userVerification: Preference;
}

export function requestOptions(input: RequestInput) {
  return {
    rpId: input.rpId,
    challenge: input.challenge,
    userVerification: input.userVerification,
    allowCredentials: [{ type: 'public-key' as const, id: fromBase64Url(input.credentialId) }],
    timeout: 120_000,
  };
}

export interface AttestationLike {
  rawId: ArrayBuffer;
  authenticatorAttachment?: string | null;
  response: {
    attestationObject: ArrayBuffer;
    clientDataJSON: ArrayBuffer;
    getTransports?: () => string[];
  };
}

export function readRegistration(credential: AttestationLike): Registration {
  const attestation = decodeCbor(toBytes(credential.response.attestationObject)).value;
  const authData = attestation instanceof Map ? attestation.get('authData') : undefined;
  if (!(authData instanceof Uint8Array)) throw new Error('Attestation object has no authenticator data');

  const parsed = parseAuthenticatorData(authData);
  if (!parsed.credential) throw new Error('Authenticator data has no attested credential');
  const key = coseToJwk(parsed.credential.cose);

  return {
    credentialId: toBase64Url(parsed.credential.credentialId),
    aaguid: parsed.credential.aaguid,
    alg: key.alg,
    algName: key.name,
    jwk: key.jwk,
    flags: parsed.flags,
    signCount: parsed.signCount,
    transports: credential.response.getTransports?.() ?? [],
    attachment: credential.authenticatorAttachment ?? null,
  };
}

export interface AssertionLike {
  rawId: ArrayBuffer;
  response: { authenticatorData: ArrayBuffer; clientDataJSON: ArrayBuffer; signature: ArrayBuffer };
}

export type CheckId = 'type' | 'challenge' | 'origin' | 'rpId' | 'userPresent' | 'signature';

export interface Check {
  id: CheckId;
  ok: boolean;
  detail: string;
}

export interface VerifyInput {
  credential: AssertionLike;
  registration: Pick<Registration, 'jwk' | 'alg'>;
  challenge: Uint8Array;
  origin: string;
  rpId: string;
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));

async function signatureIsValid(registration: VerifyInput['registration'], signature: Uint8Array, signed: Uint8Array) {
  try {
    if (registration.alg === -7) {
      const key = await crypto.subtle.importKey('jwk', registration.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature, 32) as BufferSource, signed as BufferSource);
    }
    const key = await crypto.subtle.importKey('jwk', registration.jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature as BufferSource, signed as BufferSource);
  } catch {
    return false;
  }
}

export async function verifyAssertion(input: VerifyInput) {
  const clientDataJSON = toBytes(input.credential.response.clientDataJSON);
  const authenticatorData = toBytes(input.credential.response.authenticatorData);
  const client = JSON.parse(new TextDecoder().decode(clientDataJSON)) as { type?: string; challenge?: string; origin?: string };
  const parsed = parseAuthenticatorData(authenticatorData);

  const signed = concat(authenticatorData, await sha256(clientDataJSON));
  const signatureOk = await signatureIsValid(input.registration, toBytes(input.credential.response.signature), signed);
  const expectedRpIdHash = await sha256(new TextEncoder().encode(input.rpId));

  const checks: Check[] = [
    { id: 'type', ok: client.type === 'webauthn.get', detail: String(client.type) },
    { id: 'challenge', ok: client.challenge === toBase64Url(input.challenge), detail: String(client.challenge) },
    { id: 'origin', ok: client.origin === input.origin, detail: String(client.origin) },
    { id: 'rpId', ok: equalBytes(parsed.rpIdHash, expectedRpIdHash), detail: toBase64Url(parsed.rpIdHash) },
    { id: 'userPresent', ok: parsed.flags.userPresent, detail: String(parsed.flags.userPresent) },
    { id: 'signature', ok: signatureOk, detail: toBase64Url(toBytes(input.credential.response.signature)) },
  ];

  return { ok: checks.every((check) => check.ok), checks, flags: parsed.flags, signCount: parsed.signCount };
}
