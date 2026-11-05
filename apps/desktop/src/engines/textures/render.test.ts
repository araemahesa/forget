import { describe, expect, it } from 'vitest';
import { renderTextureSvg, type TilingMode } from './render';
import {
  texturePatterns,
  type TextureMapType,
  type TextureSpec,
} from '@forgekit/contracts';

const baseSpec: TextureSpec = {
  schemaVersion: 1,
  name: 'Batu Bata Merah',
  pattern: 'bricks',
  baseColor: '#8B2500',
  accentColor: '#CD3700',
  roughness: 0.7,
  metalness: 0.1,
  scale: 4,
  seed: 42,
  resolution: 256,
};

describe('renderTextureSvg', () => {
  it('renders valid SVG for all patterns and maps', () => {
    const maps: TextureMapType[] = ['baseColor', 'normal', 'roughness', 'height'];
    for (const pattern of texturePatterns) {
      for (const mapType of maps) {
        const { svg, issues } = renderTextureSvg({ ...baseSpec, pattern }, mapType, '1x1');
        expect(issues).toEqual([]);
        expect(svg).toContain('<svg');
        expect(svg).toContain('<pattern');
        expect(svg).toContain('</svg>');
      }
    }
  });

  it('renders 1x1, 2x2, and 3x3 repetition modes', () => {
    const modes: TilingMode[] = ['1x1', '2x2', '3x3'];
    for (const mode of modes) {
      const { svg } = renderTextureSvg(baseSpec, 'baseColor', mode);
      const expectedSize = mode === '1x1' ? 256 : mode === '2x2' ? 512 : 768;
      expect(svg).toContain(`viewBox="0 0 ${expectedSize} ${expectedSize}"`);
      expect(svg).toContain(`width="${expectedSize}" height="${expectedSize}"`);
    }
  });

  it('is deterministic for identical seeds', () => {
    const res1 = renderTextureSvg({ ...baseSpec, seed: 999 });
    const res2 = renderTextureSvg({ ...baseSpec, seed: 999 });
    expect(res1.svg).toBe(res2.svg);
  });

  it('produces different output for different seeds', () => {
    const res1 = renderTextureSvg({ ...baseSpec, pattern: 'stone', seed: 100 });
    const res2 = renderTextureSvg({ ...baseSpec, pattern: 'stone', seed: 200 });
    expect(res1.svg).not.toBe(res2.svg);
  });

  it('returns empty svg when validation fails', () => {
    const { svg, issues } = renderTextureSvg({ ...baseSpec, name: '' });
    expect(svg).toBe('');
    expect(issues.length).toBeGreaterThan(0);
  });
});
