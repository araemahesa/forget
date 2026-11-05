import {
  hasBlockingGfxErrors,
  validateGfxSpec,
  type GfxSpec,
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

function layoutMarkup(spec: GfxSpec, issues: ValidationIssue[]): string {
  const size = Math.min(spec.width, spec.height);
  const padding = size * 0.08;
  const radius = size * 0.09;
  const gap = size * 0.04;
  const textGap = size * 0.015;
  const split = spec.layout === 'split';
  const textWidth = spec.width - 2 * padding - (split ? 2 * radius + gap : 0);
  // ponytail: conservative 1.1em per character; embed font metrics if exact Unicode bounds are needed.
  const titleSize = Math.min(size * 0.08, textWidth / (spec.title.length * 1.1));
  const subtitleSize = Math.min(size * 0.03, textWidth / (Math.max(1, spec.subtitle.length) * 1.1));
  for (const [path, text, fontSize, preferredSize] of [
    ['title', spec.title, titleSize, size * 0.08],
    ['subtitle', spec.subtitle, subtitleSize, size * 0.03],
  ] as const) {
    if (fontSize < preferredSize / 2) {
      issues.push({ path, severity: 'warning', message: 'Teks diperkecil agar muat; gunakan teks lebih singkat.' });
    }
    if (/[^\u0020-\u007E]/.test(text)) {
      issues.push({ path, severity: 'warning', message: 'Font Unicode dapat melampaui batas; periksa pratinjau.' });
    }
  }

  const textHeight = titleSize * 1.3 + (spec.subtitle ? textGap + subtitleSize * 1.3 : 0);
  const groupTop = (spec.height - textHeight - gap - 2 * radius) / 2;
  const stacked = spec.layout === 'stacked';
  const textTop = split ? (spec.height - textHeight) / 2 : groupTop + (stacked ? 2 * radius + gap : 0);
  const titleX = split ? padding : spec.width / 2;
  const titleY = textTop + titleSize;
  const subtitleY = titleY + titleSize * 0.3 + textGap + subtitleSize;
  const titleAnchor = split ? 'start' : 'middle';
  const accentX = split ? spec.width - padding - radius : spec.width / 2;
  const accentY = split ? spec.height / 2 : groupTop + radius + (stacked ? 0 : textHeight + gap);

  return [
    `<g data-layout="${spec.layout}">`,
    `<circle cx="${accentX}" cy="${accentY}" r="${radius}" fill="${spec.accent}" opacity="0.92"/>`,
    `<path d="M ${accentX - radius / 2} ${accentY} l ${radius / 3} ${radius / 3} l ${radius * 2 / 3} ${-radius * 7 / 9}" fill="none" stroke="${spec.background}" stroke-width="${radius / 6}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<text x="${titleX}" y="${titleY}" text-anchor="${titleAnchor}" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(spec.title)}</text>`,
    spec.subtitle ? `<text x="${titleX}" y="${subtitleY}" text-anchor="${titleAnchor}" fill="#D8DEEA" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="${subtitleSize}">${escapeXml(spec.subtitle)}</text>` : '',
    '</g>',
  ].join('');
}

export function renderGfxSvg(spec: GfxSpec): { svg: string; issues: ValidationIssue[] } {
  const issues = validateGfxSpec(spec);
  if (hasBlockingGfxErrors(issues)) {
    return { svg: '', issues };
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-label="${escapeXml(spec.title)}">`,
    `<rect width="${spec.width}" height="${spec.height}" fill="${spec.background}"/>`,
    layoutMarkup(spec, issues),
    '</svg>',
  ].join('');

  return { svg, issues };
}
