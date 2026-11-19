import { concat, fromBase64Url, toBase64Url, toBytes } from './bytes';

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

function head(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
}

export function encodeCbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const text = new TextEncoder().encode(value);
    return concat(head(3, text.length), text);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  const parts = [head(5, value.size)];
  for (const [k, v] of value) parts.push(encodeCbor(k), encodeCbor(v));
  return concat(...parts);
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let body = bytes.slice(start);
  if (body[0] & 0x80) body = concat(new Uint8Array([0]), body);
  return concat(new Uint8Array([0x02, body.length]), body);
}

export function rawToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const body = concat(derInteger(raw.slice(0, half)), derInteger(raw.slice(half)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));

export const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

export interface FakeOptions {
  rpId: string;
  origin: string;
  alg?: -7 | -257;
  flags?: number;
}

export async function createFakeAuthenticator({ rpId, origin, alg = -7, flags = FLAG.UP | FLAG.UV }: FakeOptions) {
  const params =
    alg === -7
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const keys = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const cose =
    alg === -7
      ? new Map<number, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, fromBase64Url(jwk.x!)],
          [-3, fromBase64Url(jwk.y!)],
        ])
      : new Map<number, Cbor>([
          [1, 3],
          [3, -257],
          [-1, fromBase64Url(jwk.n!)],
          [-2, fromBase64Url(jwk.e!)],
        ]);

  const credentialId = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
  const aaguid = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  let counter = 0;

  const clientData = (type: string, challenge: BufferSource, from: string) =>
    new TextEncoder().encode(JSON.stringify({ type, challenge: toBase64Url(toBytes(challenge)), origin: from, crossOrigin: false }));

  const counterBytes = () => {
    counter += 1;
    return new Uint8Array([0, 0, counter >> 8, counter & 0xff]);
  };

  return {
    credentialId,
    aaguid,
    jwk,

    async create(options: { challenge: BufferSource }) {
      const authData = concat(
        rpIdHash,
        new Uint8Array([flags | FLAG.AT]),
        counterBytes(),
        aaguid,
        new Uint8Array([0, credentialId.length]),
        credentialId,
        encodeCbor(cose),
      );
      const attestationObject = encodeCbor(
        new Map<string, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        rawId: credentialId.buffer,
        authenticatorAttachment: 'platform',
        response: {
          attestationObject: attestationObject.buffer,
          clientDataJSON: clientData('webauthn.create', options.challenge, origin).buffer,
          getTransports: () => ['internal', 'hybrid'],
        },
      };
    },

    async get(
      options: { challenge: BufferSource },
      tamper: { type?: string; origin?: string; flags?: number; rpId?: string } = {},
    ) {
      const hash = tamper.rpId ? await sha256(new TextEncoder().encode(tamper.rpId)) : rpIdHash;
      const authenticatorData = concat(hash, new Uint8Array([tamper.flags ?? flags]), counterBytes());
      const clientDataJSON = clientData(tamper.type ?? 'webauthn.get', options.challenge, tamper.origin ?? origin);
      const signed = concat(authenticatorData, await sha256(clientDataJSON));
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
          keys.privateKey,
          signed as BufferSource,
        ),
      );
      return {
        rawId: credentialId.buffer,
        response: {
          authenticatorData: authenticatorData.buffer,
          clientDataJSON: clientDataJSON.buffer,
          signature: (alg === -7 ? rawToDer(raw) : raw).buffer,
        },
      };
    },
  };
}
