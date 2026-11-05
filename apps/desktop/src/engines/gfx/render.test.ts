import { describe, expect, it } from 'vitest';
import type { GfxSpec } from '@forgekit/contracts';
import { renderGfxSvg } from './render';

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

const layouts = ['centered', 'split', 'stacked'] as const;
const canvases = [[128, 128], [4096, 128], [128, 4096], [4096, 4096], [1200, 800], [129, 257], [4095, 129], [129, 4095], [801, 799]] as const;

function expectVisibleContent(svg: string, width: number, height: number): void {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(document.querySelector('parsererror')).toBeNull();
  const circle = document.querySelector('circle')!;
  const cx = Number(circle.getAttribute('cx'));
  const cy = Number(circle.getAttribute('cy'));
  const radius = Number(circle.getAttribute('r'));
  const epsilon = 0.000001;
  expect(radius).toBeGreaterThan(0);
  expect(cx - radius).toBeGreaterThanOrEqual(-epsilon);
  expect(cy - radius).toBeGreaterThanOrEqual(-epsilon);
  expect(cx + radius).toBeLessThanOrEqual(width + epsilon);
  expect(cy + radius).toBeLessThanOrEqual(height + epsilon);

  const path = document.querySelector('path')!;
  const [x, y, dx1, dy1, dx2, dy2] = path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  const strokeRadius = Number(path.getAttribute('stroke-width')) / 2;
  for (const [px, py] of [[x, y], [x + dx1, y + dy1], [x + dx1 + dx2, y + dy1 + dy2]]) {
    expect(Math.hypot(px - cx, py - cy) + strokeRadius).toBeLessThanOrEqual(radius + epsilon);
  }

  let previousBottom = 0;
  for (const text of document.querySelectorAll('text')) {
    const fontSize = Number(text.getAttribute('font-size'));
    const textWidth = text.textContent!.length * fontSize;
    const textX = Number(text.getAttribute('x'));
    const baseline = Number(text.getAttribute('y'));
    // Conservative Latin glyph envelope, not jsdom's unimplemented font metrics.
    const left = textX - (text.getAttribute('text-anchor') === 'middle' ? textWidth / 2 : 0);
    const right = left + textWidth;
    const top = baseline - fontSize;
    const bottom = baseline + fontSize * 0.3;
    expect(fontSize).toBeGreaterThan(0);
    expect(left).toBeGreaterThanOrEqual(-epsilon);
    expect(right).toBeLessThanOrEqual(width + epsilon);
    expect(top).toBeGreaterThanOrEqual(previousBottom - epsilon);
    expect(bottom).toBeLessThanOrEqual(height + epsilon);
    expect(right <= cx - radius + epsilon || left >= cx + radius - epsilon || bottom <= cy - radius + epsilon || top >= cy + radius - epsilon).toBe(true);
    previousBottom = bottom;
  }
}

describe('renderGfxSvg', () => {
  it.each(['centered', 'split', 'stacked'] as const)('renders deterministic %s layout', (layout) => {
    const spec = validSpec(layout);
    const first = renderGfxSvg(spec);
    const second = renderGfxSvg(spec);

    expect(first.issues).toEqual([]);
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain('width="1200"');
    expect(first.svg).toContain(`data-layout="${layout}"`);
  });

  it.each(layouts)('keeps short text and complete accent visible on %s canvas extremes', (layout) => {
    for (const [width, height] of canvases) {
      const spec = { ...validSpec(layout), width, height };
      const { svg, issues } = renderGfxSvg(spec);
      expect(issues).toEqual([]);
      expect(svg).toBe(renderGfxSvg(spec).svg);
      expectVisibleContent(svg, width, height);
    }
  });

  it.each(layouts)('fits maximum-length text without truncation on %s canvases', (layout) => {
    for (const [width, height] of canvases) {
      const spec = { ...validSpec(layout), width, height, title: 'W'.repeat(120), subtitle: 'M'.repeat(240) };
      const { svg } = renderGfxSvg(spec);
      expect(svg).toBe(renderGfxSvg(spec).svg);
      const text = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text');
      expect(Array.from(text, (line) => line.textContent)).toEqual([spec.title, spec.subtitle]);
      expectVisibleContent(svg, width, height);
    }
  });

  it('warns when fitting long text makes it very small', () => {
    const { issues } = renderGfxSvg({ ...validSpec('split'), width: 128, height: 128, title: 'W'.repeat(120), subtitle: 'M'.repeat(240) });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'title', severity: 'warning' }),
      expect.objectContaining({ path: 'subtitle', severity: 'warning' }),
    ]));
  });

  it('warns when platform font fallback prevents reliable Unicode bounds', () => {
    const { svg, issues } = renderGfxSvg({ ...validSpec(), title: '界'.repeat(60), subtitle: 'e\u0301 😀' });
    expect(svg).toContain('界'.repeat(60));
    expect(svg).toContain('e\u0301 😀');
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'title', severity: 'warning' }),
      expect.objectContaining({ path: 'subtitle', severity: 'warning' }),
    ]));
  });

  it('keeps layout geometry distinct beyond its data attribute', () => {
    const markup = layouts.map((layout) => renderGfxSvg(validSpec(layout)).svg.replace(/data-layout="[^"]+"/, ''));
    expect(new Set(markup).size).toBe(3);
  });

  it.each(layouts)('keeps title and accent visible with empty subtitle in %s', (layout) => {
    const { svg, issues } = renderGfxSvg({ ...validSpec(layout), width: 128, height: 128, subtitle: '' });
    expect(issues).toEqual([]);
    expectVisibleContent(svg, 128, 128);
  });

  it('escapes XML text', () => {
    const { svg, issues } = renderGfxSvg({ ...validSpec(), title: '<unsafe & title>' });

    expect(issues).toEqual([]);
    expect(svg).toContain('&lt;unsafe &amp; title&gt;');
    expect(svg).not.toContain('<unsafe & title>');
  });

  it('returns no SVG for blocking input', () => {
    const { svg, issues } = renderGfxSvg({ ...validSpec(), accent: 'red' });

    expect(svg).toBe('');
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'accent', severity: 'error' }),
    ]));
  });
});
