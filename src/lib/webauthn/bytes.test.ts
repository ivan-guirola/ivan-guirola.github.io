import { describe, expect, it } from 'vitest';
import { concat, equalBytes, fromBase64Url, toBase64Url, toBytes, toHex } from './bytes';

describe('bytes', () => {
  it('encodes base64url without padding or URL-unsafe characters', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(toBase64Url(new Uint8Array([1]))).toBe('AQ');
  });

  it('round-trips arbitrary bytes through base64url', () => {
    const bytes = Uint8Array.from({ length: 70 }, (_, i) => (i * 37) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('decodes the empty string to no bytes', () => {
    expect(fromBase64Url('')).toEqual(new Uint8Array());
  });

  it('rejects text that is not base64url', () => {
    expect(() => fromBase64Url('a+b/')).toThrow(/base64url/i);
  });

  it('formats bytes as lowercase hex', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });

  it('concatenates byte arrays in order', () => {
    expect(concat(new Uint8Array([1]), new Uint8Array(), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('compares byte arrays by content and length', () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false);
  });

  it('views an ArrayBuffer or a typed-array slice as bytes', () => {
    const buffer = new Uint8Array([9, 8, 7, 6]).buffer;
    expect(toBytes(buffer)).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(toBytes(new Uint8Array(buffer, 1, 2))).toEqual(new Uint8Array([8, 7]));
  });
});
