import {
  hasBlockingTextureErrors,
  validateTextureSpec,
  type TextureMapType,
  type TexturePattern,
  type TextureSpec,
  type ValidationIssue,
} from '@forgekit/contracts';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// Deterministic Mulberry32 PRNG
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export type TilingMode = '1x1' | '2x2' | '3x3';

function getPatternMarkup(
  pattern: TexturePattern,
  mapType: TextureMapType,
  spec: TextureSpec,
): string {
  const isNormal = mapType === 'normal';
  const isRoughness = mapType === 'roughness';
  const isHeight = mapType === 'height';

  // Colors per map type
  const baseFill = isNormal
    ? '#8080FF'
    : isRoughness
      ? `rgb(${Math.round(spec.roughness * 255)}, ${Math.round(spec.roughness * 255)}, ${Math.round(spec.roughness * 255)})`
      : isHeight
        ? '#B0B0B0'
        : spec.baseColor;

  const accentFill = isNormal
    ? '#A060FF'
    : isRoughness
      ? `rgb(${Math.round(Math.min(1, spec.roughness * 1.3) * 255)}, ${Math.round(Math.min(1, spec.roughness * 1.3) * 255)}, ${Math.round(Math.min(1, spec.roughness * 1.3) * 255)})`
      : isHeight
        ? '#E0E0E0'
        : spec.accentColor;

  const mortarFill = isNormal ? '#7070F0' : isRoughness ? '#FFFFFF' : isHeight ? '#303030' : '#2A2A2A';

  const rows = spec.scale * 2;
  const cols = spec.scale * 2;
  const tileW = 256 / cols;
  const tileH = 256 / rows;

  switch (pattern) {
    case 'bricks': {
      const parts: string[] = [`<rect width="256" height="256" fill="${mortarFill}"/>`];
      const mortar = Math.max(2, Math.floor(tileH * 0.12));
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2 === 0 ? 0 : tileW / 2);
        const y = r * tileH + mortar / 2;
        const h = tileH - mortar;
        for (let c = -1; c <= cols; c++) {
          const x = c * tileW + offset + mortar / 2;
          const w = tileW - mortar;
          const color = (r + c + spec.seed) % 3 === 0 ? accentFill : baseFill;
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`,
          );
        }
      }
      return parts.join('');
    }

    case 'wood': {
      const parts: string[] = [`<rect width="256" height="256" fill="${baseFill}"/>`];
      const planks = spec.scale;
      const plankW = 256 / planks;
      for (let p = 0; p < planks; p++) {
        const x = p * plankW;
        parts.push(
          `<line x1="${x}" y1="0" x2="${x}" y2="256" stroke="${mortarFill}" stroke-width="2"/>`,
        );
        // Wood grain lines
        for (let g = 1; g < 4; g++) {
          const gx = x + (plankW * g) / 4;
          parts.push(
            `<path d="M ${gx} 0 Q ${gx + (g % 2 === 0 ? 6 : -6)} 128 ${gx} 256" stroke="${accentFill}" stroke-width="1.5" stroke-opacity="0.4" fill="none"/>`,
          );
        }
      }
      return parts.join('');
    }

    case 'metal_grid': {
      const parts: string[] = [`<rect width="256" height="256" fill="${baseFill}"/>`];
      const step = 256 / spec.scale;
      const r = step * 0.28;
      for (let x = 0; x <= 256; x += step) {
        for (let y = 0; y <= 256; y += step) {
          parts.push(
            `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${mortarFill}"/>`,
          );
        }
      }
      return parts.join('');
    }

    case 'hex_tiles': {
      const parts: string[] = [`<rect width="256" height="256" fill="${mortarFill}"/>`];
      const size = 256 / (spec.scale * 1.5);
      const h = size * Math.sqrt(3);
      for (let row = -1; row <= spec.scale * 2; row++) {
        const y = row * h;
        const xOffset = row % 2 === 0 ? 0 : (size * 1.5);
        for (let col = -1; col <= spec.scale * 2; col++) {
          const x = col * size * 3 + xOffset;
          const color = (row + col + spec.seed) % 2 === 0 ? baseFill : accentFill;
          parts.push(
            `<polygon points="${(x + size).toFixed(1)},${y.toFixed(1)} ${(x + size / 2).toFixed(1)},${(y + h / 2).toFixed(1)} ${(x - size / 2).toFixed(1)},${(y + h / 2).toFixed(1)} ${(x - size).toFixed(1)},${y.toFixed(1)} ${(x - size / 2).toFixed(1)},${(y - h / 2).toFixed(1)} ${(x + size / 2).toFixed(1)},${(y - h / 2).toFixed(1)}" fill="${color}" stroke="${mortarFill}" stroke-width="2"/>`,
          );
        }
      }
      return parts.join('');
    }

    case 'fabric': {
      const parts: string[] = [`<rect width="256" height="256" fill="${baseFill}"/>`];
      const step = Math.max(8, 256 / (spec.scale * 4));
      for (let i = 0; i <= 256; i += step) {
        parts.push(
          `<line x1="${i}" y1="0" x2="${i}" y2="256" stroke="${accentFill}" stroke-width="2" stroke-opacity="0.35"/>`,
          `<line x1="0" y1="${i}" x2="256" y2="${i}" stroke="${mortarFill}" stroke-width="2" stroke-opacity="0.35"/>`,
        );
      }
      return parts.join('');
    }

    case 'stone': {
      const parts: string[] = [`<rect width="256" height="256" fill="${mortarFill}"/>`];
      const rng = mulberry32(spec.seed);
      const stones = spec.scale * 2;
      const sW = 256 / stones;
      const sH = 256 / stones;
      for (let r = 0; r < stones; r++) {
        for (let c = 0; c < stones; c++) {
          const x = c * sW + 3;
          const y = r * sH + 3;
          const w = sW - 6;
          const h = sH - 6;
          const color = rng() > 0.5 ? baseFill : accentFill;
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${color}"/>`,
          );
        }
      }
      return parts.join('');
    }

    case 'noise':
    default: {
      const parts: string[] = [`<rect width="256" height="256" fill="${baseFill}"/>`];
      const rng = mulberry32(spec.seed);
      const dots = spec.scale * 30;
      for (let i = 0; i < dots; i++) {
        const x = Math.round(rng() * 256);
        const y = Math.round(rng() * 256);
        const r = (rng() * 4 + 1).toFixed(1);
        const opacity = (rng() * 0.4 + 0.1).toFixed(2);
        const color = rng() > 0.5 ? accentFill : mortarFill;
        parts.push(
          `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity="${opacity}"/>`,
        );
      }
      return parts.join('');
    }
  }
}

export function renderTextureSvg(
  spec: TextureSpec,
  mapType: TextureMapType = 'baseColor',
  tiling: TilingMode = '1x1',
): { svg: string; issues: ValidationIssue[] } {
  const issues = validateTextureSpec(spec);
  if (hasBlockingTextureErrors(issues)) {
    return { svg: '', issues };
  }

  const patternId = `pat-${spec.pattern}-${spec.seed}-${mapType}`;
  const patternInner = getPatternMarkup(spec.pattern, mapType, spec);

  const repeatCount = tiling === '1x1' ? 1 : tiling === '2x2' ? 2 : 3;
  const viewSize = 256 * repeatCount;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.resolution}" height="${spec.resolution}" viewBox="0 0 ${viewSize} ${viewSize}" role="img" aria-label="${escapeXml(spec.name)} - ${mapType} (${tiling})">`,
    '<defs>',
    `<pattern id="${patternId}" width="256" height="256" patternUnits="userSpaceOnUse">`,
    patternInner,
    '</pattern>',
    '</defs>',
    `<rect width="${viewSize}" height="${viewSize}" fill="url(#${patternId})"/>`,
    '</svg>',
  ].join('');

  return { svg, issues };
}
