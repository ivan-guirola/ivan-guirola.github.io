export type CborValue = number | string | boolean | null | Uint8Array | CborValue[] | Map<number | string, CborValue>;

export function decodeCbor(bytes: Uint8Array, start = 0): { value: CborValue; end: number } {
  let offset = start;

  const take = (count: number): Uint8Array => {
    if (offset + count > bytes.length) throw new Error('Truncated CBOR data');
    offset += count;
    return bytes.subarray(offset - count, offset);
  };

  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return take(1)[0];
    if (info === 25) return take(2).reduce((n, byte) => n * 256 + byte, 0);
    if (info === 26) return take(4).reduce((n, byte) => n * 256 + byte, 0);
    throw new Error(`Unsupported CBOR length encoding (${info})`);
  };

  const read = (): CborValue => {
    const initial = take(1)[0];
    const major = initial >> 5;
    const info = initial & 0x1f;

    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new Error(`Unsupported CBOR simple value (${info})`);
    }

    const length = readLength(info);
    switch (major) {
      case 0:
        return length;
      case 1:
        return -1 - length;
      case 2:
        return take(length).slice();
      case 3:
        return new TextDecoder().decode(take(length));
      case 4:
        return Array.from({ length }, read);
      case 5: {
        const map = new Map<number | string, CborValue>();
        for (let i = 0; i < length; i++) {
          const key = read();
          if (typeof key !== 'number' && typeof key !== 'string') throw new Error('Unsupported CBOR map key');
          map.set(key, read());
        }
        return map;
      }
      default:
        throw new Error(`Unsupported CBOR major type (${major})`);
    }
  };

  const value = read();
  return { value, end: offset };
}
