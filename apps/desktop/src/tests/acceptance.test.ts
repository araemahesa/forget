import { describe, expect, it } from 'vitest';
import type { GfxSpec } from '@forgekit/contracts';
import { validateGfxSpec } from '@forgekit/contracts';
import { assertPngDimensions } from '../engines/gfx/png';
import { renderGfxSvg } from '../engines/gfx/render';

const validSpec = (layout: GfxSpec['layout'] = 'centered'): GfxSpec => ({
  schemaVersion: 1,
  title: 'ForgeKit',
  subtitle: 'Create clearly',
  background: '#101216',
  accent: '#94ACFF',
  layout,
  width: 1200,
  height: 800,
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('Foundation + GFX acceptance', () => {
  it('renders valid brief and rejects invalid brief', () => {
    const rendered = renderGfxSvg(validSpec());
    expect(rendered.issues).toEqual([]);
    expect(rendered.svg).not.toBe('');
    expect(validateGfxSpec({ ...validSpec(), title: '', width: 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'title', severity: 'error' }),
      expect.objectContaining({ path: 'width', severity: 'error' }),
    ]));
  });

  it.each(['centered', 'split', 'stacked'] as const)('keeps %s output deterministic', (layout) => {
    const first = renderGfxSvg(validSpec(layout));
    const second = renderGfxSvg(validSpec(layout));
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain(`data-layout="${layout}"`);
  });

  it('escapes XML and validates PNG dimensions', () => {
    const rendered = renderGfxSvg({ ...validSpec(), title: '<unsafe & title>' });
    expect(rendered.svg).toContain('&lt;unsafe &amp; title&gt;');
    expect(rendered.svg).not.toContain('<unsafe & title>');
    expect(() => assertPngDimensions(pngHeader(1200, 800), 1200, 800)).not.toThrow();
    expect(() => assertPngDimensions(pngHeader(1200, 799), 1200, 800)).toThrow(/dimensi/i);
  });
});
