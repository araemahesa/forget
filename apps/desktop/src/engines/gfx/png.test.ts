// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertPngDimensions, svgToPng } from './png';

const pngHeader = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

describe('assertPngDimensions', () => {
  it('accepts PNG signature and requested dimensions', () => {
    expect(() => assertPngDimensions(pngHeader(1200, 800), 1200, 800)).not.toThrow();
  });

  it.each([24, 32])('menolak header PNG terpotong pada %i bita', (length) => {
    expect(() => assertPngDimensions(pngHeader(1200, 800).subarray(0, length), 1200, 800)).toThrow();
  });

  it('menolak panjang atau tipe chunk IHDR yang salah', () => {
    const wrongLength = pngHeader(1200, 800);
    new DataView(wrongLength.buffer).setUint32(8, 12);
    expect(() => assertPngDimensions(wrongLength, 1200, 800)).toThrow();
    const wrongType = pngHeader(1200, 800);
    wrongType.set([73, 68, 65, 84], 12);
    expect(() => assertPngDimensions(wrongType, 1200, 800)).toThrow();
  });

  it('membaca header valid dari tampilan dengan offset', () => {
    const bytes = new Uint8Array(40);
    bytes.set(pngHeader(1200, 800), 7);
    expect(() => assertPngDimensions(bytes.subarray(7), 1200, 800)).not.toThrow();
  });

  it('rejects wrong dimensions and invalid signatures', () => {
    expect(() => assertPngDimensions(pngHeader(1200, 799), 1200, 800)).toThrow(/dimensi/i);
    expect(() => assertPngDimensions(new Uint8Array(33), 1200, 800)).toThrow(/penanda/i);
  });

  it('rejects SVG conversion outside browser runtime', async () => {
    await expect(svgToPng('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 1200, 800)).rejects.toThrow(/peramban/i);
  });
});
