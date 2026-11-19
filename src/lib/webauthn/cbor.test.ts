import { describe, expect, it } from 'vitest';
import { decodeCbor } from './cbor';

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));

describe('decodeCbor', () => {
  it('decodes unsigned integers of every width', () => {
    expect(decodeCbor(hex('0a')).value).toBe(10);
    expect(decodeCbor(hex('1864')).value).toBe(100);
    expect(decodeCbor(hex('1903e8')).value).toBe(1000);
    expect(decodeCbor(hex('1a000f4240')).value).toBe(1_000_000);
  });

  it('decodes negative integers', () => {
    expect(decodeCbor(hex('26')).value).toBe(-7);
    expect(decodeCbor(hex('390100')).value).toBe(-257);
  });

  it('decodes byte strings and text strings', () => {
    expect(decodeCbor(hex('4401020304')).value).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(decodeCbor(hex('64f09f9491')).value).toBe('🔑');
  });

  it('decodes arrays and booleans', () => {
    expect(decodeCbor(hex('8301f5f6')).value).toEqual([1, true, null]);
  });

  it('decodes nested maps with integer and text keys', () => {
    const { value } = decodeCbor(hex('a3010263666d74646e6f6e65616da12041ff'));
    const map = value as Map<unknown, unknown>;
    expect(map.get(1)).toBe(2);
    expect(map.get('fmt')).toBe('none');
    expect((map.get('m') as Map<unknown, unknown>).get(-1)).toEqual(new Uint8Array([0xff]));
  });

  it('reports where the item ends so trailing data can be read', () => {
    expect(decodeCbor(hex('4201020a0b')).end).toBe(3);
    expect(decodeCbor(hex('ff0a'), 1)).toEqual({ value: 10, end: 2 });
  });

  it('rejects truncated input', () => {
    expect(() => decodeCbor(hex('44010203'))).toThrow(/truncated/i);
    expect(() => decodeCbor(hex(''))).toThrow(/truncated/i);
  });

  it('rejects encodings it does not support', () => {
    expect(() => decodeCbor(hex('5f'))).toThrow(/unsupported/i);
    expect(() => decodeCbor(hex('fb3ff0000000000000'))).toThrow(/unsupported/i);
  });
});
