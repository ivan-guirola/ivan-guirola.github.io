export interface Certificate {
  subject: string;
  issuer: string;
  serial: string;
  notBefore: number;
  notAfter: number;
  key: string;
  selfSigned: boolean;
}

export type CertificateStatus = 'valid' | 'expiringSoon' | 'expired' | 'notYetValid';

interface Node {
  tag: number;
  raw: Uint8Array;
  content: Uint8Array;
  children: Node[];
}

const DAY = 86_400_000;
const COMMON_NAME = '550403';
const RSA = '2a864886f70d010101';
const EC = '2a8648ce3d0201';
const CURVES: Record<string, string> = {
  '2a8648ce3d030107': 'P-256',
  '2b81040022': 'P-384',
  '2b81040023': 'P-521',
};
const EDWARDS: Record<string, string> = { '2b6570': 'Ed25519', '2b6571': 'Ed448' };

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function toBytes(text: string): Uint8Array {
  const clean = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error('Not Base64');
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
}

function read(bytes: Uint8Array, offset: number): Node {
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let start = offset + 2;
  if (length === undefined) throw new Error('Truncated');
  if (length & 0x80) {
    const size = length & 0x7f;
    if (size === 0 || size > 4) throw new Error('Unsupported length');
    length = 0;
    for (let i = 0; i < size; i++) length = length * 256 + bytes[start + i];
    start += size;
  }
  const end = start + length;
  if (!(end <= bytes.length)) throw new Error('Truncated');

  const children: Node[] = [];
  if (tag & 0x20) {
    for (let at = start; at < end; ) {
      const child = read(bytes, at);
      children.push(child);
      at += child.raw.length;
    }
  }
  return { tag, raw: bytes.subarray(offset, end), content: bytes.subarray(start, end), children };
}

function name(node: Node): string {
  const attributes = node.children.flatMap((set) => set.children);
  const chosen = attributes.find((attribute) => hex(attribute.children[0].content) === COMMON_NAME) ?? attributes.at(-1);
  return chosen ? new TextDecoder().decode(chosen.children[1].content) : '';
}

function time(node: Node): number {
  const text = new TextDecoder().decode(node.content);
  const digits = node.tag === 0x17 ? (Number(text.slice(0, 2)) >= 50 ? '19' : '20') + text : text;
  const [year, month, day, hour, minute, second] = [0, 4, 6, 8, 10, 12].map((at, i) =>
    Number(digits.slice(at, at + (i === 0 ? 4 : 2))),
  );
  const value = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(value)) throw new Error('Bad date');
  return value;
}

function keyOf(info: Node): string {
  const [algorithm, bits] = info.children;
  const id = hex(algorithm.children[0].content);
  if (id === RSA) {
    const modulus = read(bits.content.subarray(1), 0).children[0].content;
    const significant = modulus.subarray(modulus.findIndex((byte) => byte !== 0));
    return `RSA ${significant.length * 8}`;
  }
  if (id === EC) return `EC ${CURVES[hex(algorithm.children[1]?.content ?? new Uint8Array())] ?? 'unknown curve'}`;
  return EDWARDS[id] ?? 'Unknown';
}

export function parseCertificate(text: string): Certificate {
  try {
    const bytes = toBytes(text);
    const root = read(bytes, 0);
    const fields = root.children[0]?.children ?? [];
    if (root.tag !== 0x30 || root.raw.length !== bytes.length || fields.length < 6) throw new Error('Unexpected shape');

    const [serial, , issuer, validity, subject, info] = fields[0].tag === 0xa0 ? fields.slice(1) : fields;
    return {
      subject: name(subject),
      issuer: name(issuer),
      serial: hex(serial.content).replace(/^00(?=.)/, ''),
      notBefore: time(validity.children[0]),
      notAfter: time(validity.children[1]),
      key: keyOf(info),
      selfSigned: hex(issuer.raw) === hex(subject.raw),
    };
  } catch {
    throw new Error('Not a certificate');
  }
}

export function certificateStatus(certificate: Certificate, now: number, soonDays = 30): CertificateStatus {
  if (now < certificate.notBefore) return 'notYetValid';
  if (now >= certificate.notAfter) return 'expired';
  return certificate.notAfter - now <= soonDays * DAY ? 'expiringSoon' : 'valid';
}

export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toBytes(text) as BufferSource);
  return hex(new Uint8Array(digest)).toUpperCase().match(/../g)!.join(':');
}
