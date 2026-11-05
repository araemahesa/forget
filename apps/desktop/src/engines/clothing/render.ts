import type { ClothingSpec, ValidationIssue } from '@forgekit/contracts';
import { clothingDimensions, validateClothingSpec, hasBlockingClothingErrors } from '@forgekit/contracts';

export type ClothingViewMode = 'template' | 'avatar';

export type TemplateBox = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

// Official Roblox Classic Shirt Coordinates (585 × 559)
export const shirtBoxes: TemplateBox[] = [
  // Torso
  { id: 'torso_top', label: 'T-TOP', x: 231, y: 74, w: 128, h: 64 },
  { id: 'torso_bottom', label: 'T-BOT', x: 231, y: 266, w: 128, h: 64 },
  { id: 'torso_right', label: 'T-R', x: 167, y: 138, w: 64, h: 128 },
  { id: 'torso_front', label: 'TORSO FRONT', x: 231, y: 138, w: 128, h: 128 },
  { id: 'torso_left', label: 'T-L', x: 359, y: 138, w: 64, h: 128 },
  { id: 'torso_back', label: 'TORSO BACK', x: 423, y: 138, w: 128, h: 128 },
  // Right Arm
  { id: 'rarm_top', label: 'RA-TOP', x: 85, y: 334, w: 64, h: 64 },
  { id: 'rarm_bottom', label: 'RA-BOT', x: 85, y: 526, w: 64, h: 64 },
  { id: 'rarm_right', label: 'RA-R', x: 21, y: 398, w: 64, h: 128 },
  { id: 'rarm_front', label: 'RA-FRONT', x: 85, y: 398, w: 64, h: 128 },
  { id: 'rarm_left', label: 'RA-L', x: 149, y: 398, w: 64, h: 128 },
  { id: 'rarm_back', label: 'RA-BACK', x: 213, y: 398, w: 64, h: 128 },
  // Left Arm
  { id: 'larm_top', label: 'LA-TOP', x: 373, y: 334, w: 64, h: 64 },
  { id: 'larm_bottom', label: 'LA-BOT', x: 373, y: 526, w: 64, h: 64 },
  { id: 'larm_front', label: 'LA-FRONT', x: 373, y: 398, w: 64, h: 128 },
  { id: 'larm_right', label: 'LA-R', x: 309, y: 398, w: 64, h: 128 },
  { id: 'larm_back', label: 'LA-BACK', x: 501, y: 398, w: 64, h: 128 },
  { id: 'larm_left', label: 'LA-L', x: 437, y: 398, w: 64, h: 128 },
];

// Official Roblox Classic Pants Coordinates (585 × 559)
export const pantsBoxes: TemplateBox[] = [
  // Pelvis / Hip
  { id: 'pelvis_top', label: 'P-TOP', x: 231, y: 74, w: 128, h: 64 },
  { id: 'pelvis_bottom', label: 'P-BOT', x: 231, y: 266, w: 128, h: 64 },
  { id: 'pelvis_right', label: 'P-R', x: 167, y: 138, w: 64, h: 128 },
  { id: 'pelvis_front', label: 'PELVIS FRONT', x: 231, y: 138, w: 128, h: 128 },
  { id: 'pelvis_left', label: 'P-L', x: 359, y: 138, w: 64, h: 128 },
  { id: 'pelvis_back', label: 'PELVIS BACK', x: 423, y: 138, w: 128, h: 128 },
  // Right Leg
  { id: 'rleg_top', label: 'RL-TOP', x: 85, y: 334, w: 64, h: 64 },
  { id: 'rleg_bottom', label: 'RL-BOT', x: 85, y: 526, w: 64, h: 64 },
  { id: 'rleg_right', label: 'RL-R', x: 21, y: 398, w: 64, h: 128 },
  { id: 'rleg_front', label: 'RL-FRONT', x: 85, y: 398, w: 64, h: 128 },
  { id: 'rleg_left', label: 'RL-L', x: 149, y: 398, w: 64, h: 128 },
  { id: 'rleg_back', label: 'RL-BACK', x: 213, y: 398, w: 64, h: 128 },
  // Left Leg
  { id: 'lleg_top', label: 'LL-TOP', x: 373, y: 334, w: 64, h: 64 },
  { id: 'lleg_bottom', label: 'LL-BOT', x: 373, y: 526, w: 64, h: 64 },
  { id: 'lleg_front', label: 'LL-FRONT', x: 373, y: 398, w: 64, h: 128 },
  { id: 'lleg_right', label: 'LL-R', x: 309, y: 398, w: 64, h: 128 },
  { id: 'lleg_back', label: 'LL-BACK', x: 501, y: 398, w: 64, h: 128 },
  { id: 'lleg_left', label: 'LL-L', x: 437, y: 398, w: 64, h: 128 },
];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderPatternDefs(spec: ClothingSpec): string {
  const { pattern, baseColor, accentColor, cuffColor } = spec;

  let patternMarkup = '';
  switch (pattern) {
    case 'stripes':
      patternMarkup = `
        <pattern id="clothing-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="10" fill="${baseColor}" />
          <rect y="10" width="20" height="10" fill="${accentColor}" />
        </pattern>`;
      break;
    case 'plaid':
      patternMarkup = `
        <pattern id="clothing-pattern" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="${baseColor}" />
          <rect width="16" height="32" fill="${accentColor}" fill-opacity="0.35" />
          <rect width="32" height="16" fill="${accentColor}" fill-opacity="0.35" />
          <line x1="8" y1="0" x2="8" y2="32" stroke="${cuffColor}" stroke-width="1.5" />
          <line x1="0" y1="8" x2="32" y2="8" stroke="${cuffColor}" stroke-width="1.5" />
        </pattern>`;
      break;
    case 'denim':
      patternMarkup = `
        <pattern id="clothing-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="${baseColor}" />
          <path d="M0 0 L8 8 M8 0 L0 8" stroke="${accentColor}" stroke-width="0.8" stroke-opacity="0.25" />
        </pattern>`;
      break;
    case 'camo':
      patternMarkup = `
        <pattern id="clothing-pattern" width="48" height="48" patternUnits="userSpaceOnUse">
          <rect width="48" height="48" fill="${baseColor}" />
          <path d="M4 8 Q16 2 24 10 Q32 18 20 28 Q8 32 4 20 Z" fill="${accentColor}" />
          <path d="M28 24 Q40 18 44 32 Q42 44 30 42 Q20 38 28 24 Z" fill="${cuffColor}" />
        </pattern>`;
      break;
    case 'hoodie':
    case 'solid':
    default:
      patternMarkup = `
        <pattern id="clothing-pattern" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill="${baseColor}" />
        </pattern>`;
      break;
  }

  return `
    <defs>
      ${patternMarkup}
      <linearGradient id="fold-shade-v" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000" stop-opacity="0.22" />
        <stop offset="15%" stop-color="#000" stop-opacity="0" />
        <stop offset="85%" stop-color="#000" stop-opacity="0" />
        <stop offset="100%" stop-color="#000" stop-opacity="0.25" />
      </linearGradient>
      <linearGradient id="fold-shade-h" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#000" stop-opacity="0.2" />
        <stop offset="20%" stop-color="#000" stop-opacity="0" />
        <stop offset="80%" stop-color="#000" stop-opacity="0" />
        <stop offset="100%" stop-color="#000" stop-opacity="0.2" />
      </linearGradient>
    </defs>`;
}

function renderNeckDetails(spec: ClothingSpec, box: TemplateBox): string {
  if (box.id !== 'torso_front') return '';
  const cx = box.x + box.w / 2;
  const cy = box.y;

  switch (spec.neckStyle) {
    case 'round':
      return `<path d="M${cx - 24} ${cy} Q${cx} ${cy + 22} ${cx + 24} ${cy}" fill="none" stroke="${spec.cuffColor}" stroke-width="4" stroke-linecap="round" />`;
    case 'v_neck':
      return `<path d="M${cx - 22} ${cy} L${cx} ${cy + 26} L${cx + 22} ${cy}" fill="none" stroke="${spec.cuffColor}" stroke-width="4" stroke-linejoin="round" />`;
    case 'collar':
      return `
        <path d="M${cx - 26} ${cy} L${cx - 10} ${cy + 24} L${cx} ${cy + 10} L${cx + 10} ${cy + 24} L${cx + 26} ${cy}" fill="${spec.accentColor}" stroke="${spec.cuffColor}" stroke-width="2" />
        <circle cx="${cx}" cy="${cy + 34}" r="2.5" fill="${spec.cuffColor}" />
        <circle cx="${cx}" cy="${cy + 52}" r="2.5" fill="${spec.cuffColor}" />`;
    case 'crew':
      return `<rect x="${cx - 28}" y="${cy}" width="56" height="8" rx="2" fill="${spec.cuffColor}" />`;
  }
}

function renderPocketDetails(spec: ClothingSpec, box: TemplateBox): string {
  if (!spec.pocket || box.id !== 'torso_front') return '';
  const cx = box.x + box.w / 2;
  const cy = box.y;

  if (spec.pattern === 'hoodie') {
    // Kangaroo pocket
    const px = cx - 36;
    const py = cy + 68;
    return `
      <path d="M${px} ${py + 36} L${px + 8} ${py} L${px + 64} ${py} L${px + 72} ${py + 36} Z" fill="${spec.accentColor}" stroke="${spec.cuffColor}" stroke-width="1.8" />
      <line x1="${cx}" y1="${cy + 10}" x2="${cx}" y2="${py + 36}" stroke="${spec.cuffColor}" stroke-width="2" stroke-dasharray="3 2" />`;
  }

  // Chest pocket
  const px = box.x + box.w - 42;
  const py = box.y + 32;
  return `
    <path d="M${px} ${py} h26 v20 l-13 8 l-13 -8 Z" fill="${spec.accentColor}" stroke="${spec.cuffColor}" stroke-width="1.5" />
    <line x1="${px}" y1="${py + 4}" x2="${px + 26}" y2="${py + 4}" stroke="${spec.cuffColor}" stroke-width="1.5" />`;
}

export function renderClothingTemplateSvg(spec: ClothingSpec): { svg: string; issues: ValidationIssue[] } {
  const issues = validateClothingSpec(spec);
  if (hasBlockingClothingErrors(issues)) return { svg: '', issues };
  const { width, height } = clothingDimensions(spec.kind);

  if (spec.kind === 'tshirt') {
    // T-Shirt 512x512 Graphic Decal
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${escapeXml(spec.name)}">
  ${renderPatternDefs(spec)}
  <rect width="512" height="512" fill="url(#clothing-pattern)" />
  ${spec.shading ? `<rect width="512" height="512" fill="url(#fold-shade-v)" />` : ''}
  <!-- T-Shirt Graphic Embellishment -->
  <g transform="translate(156, 156)">
    <circle cx="100" cy="100" r="90" fill="${spec.accentColor}" opacity="0.9" />
    <circle cx="100" cy="100" r="82" fill="none" stroke="${spec.cuffColor}" stroke-width="4" />
    <path d="M65 130 L100 65 L135 130 Z" fill="${spec.cuffColor}" />
  </g>
  ${
    spec.templateGuide
      ? `<rect x="0" y="0" width="512" height="512" fill="none" stroke="#ff405f" stroke-width="2" stroke-dasharray="8 4" />
         <text x="256" y="480" fill="#ff405f" font-family="-apple-system, sans-serif" font-size="16" font-weight="600" text-anchor="middle">ROBLOX T-SHIRT 512×512</text>`
      : ''
  }
</svg>`;
    return { svg, issues };
  }

  const boxes = spec.kind === 'shirt' ? shirtBoxes : pantsBoxes;
  const defs = renderPatternDefs(spec);

  const boxesMarkup = boxes
    .map((box) => {
      const isArmOrLegBottom = box.id.includes('bottom') && (box.id.includes('arm') || box.id.includes('leg'));
      const fillColor = isArmOrLegBottom ? spec.cuffColor : 'url(#clothing-pattern)';

      return `
    <g id="box-${box.id}">
      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fillColor}" />
      ${spec.shading ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#fold-shade-v)" />` : ''}
      ${renderNeckDetails(spec, box)}
      ${renderPocketDetails(spec, box)}
      ${
        spec.templateGuide
          ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="#ff405f" stroke-width="1.2" opacity="0.8" />
             <text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 + 4}" fill="#ffffff" font-family="-apple-system, sans-serif" font-size="9" font-weight="600" text-anchor="middle" letter-spacing="0.5">${escapeXml(box.label)}</text>`
          : ''
      }
    </g>`;
    })
    .join('\n');

  const guideBackground = spec.templateGuide
    ? `<rect width="${width}" height="${height}" fill="#161518" />`
    : `<rect width="${width}" height="${height}" fill="transparent" />`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(spec.name)}">
  ${defs}
  ${guideBackground}
  ${boxesMarkup}
</svg>`;

  return { svg, issues };
}

export function renderAvatarPreviewSvg(spec: ClothingSpec): { svg: string } {
  if (hasBlockingClothingErrors(validateClothingSpec(spec))) return { svg: '' };
  // Folded R6 Avatar 2D Model Showcase
  const { baseColor, accentColor, cuffColor } = spec;
  const isShirt = spec.kind === 'shirt';
  const isPants = spec.kind === 'pants';
  const isTshirt = spec.kind === 'tshirt';

  const torsoFill = isShirt || isTshirt ? 'url(#clothing-pattern)' : '#34495e';
  const pantsFill = isPants ? 'url(#clothing-pattern)' : '#2c3e50';
  const armFill = isShirt ? 'url(#clothing-pattern)' : '#f1c40f'; // yellow skin if not shirt

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 380" width="320" height="380" role="img" aria-label="${escapeXml(spec.name)}">
  ${renderPatternDefs(spec)}
  <g transform="translate(160, 40)" text-anchor="middle">
    <!-- Head -->
    <rect x="-35" y="0" width="70" height="70" rx="14" fill="#f1c40f" stroke="#d4ac0d" stroke-width="2" />
    <circle cx="-14" cy="32" r="4" fill="#2c3e50" />
    <circle cx="14" cy="32" r="4" fill="#2c3e50" />
    <path d="M-10 48 Q0 56 10 48" stroke="#2c3e50" stroke-width="3" fill="none" stroke-linecap="round" />

    <!-- Left Arm -->
    <g transform="translate(56, 76)">
      <rect x="0" y="0" width="46" height="96" rx="6" fill="${armFill}" stroke="#222" stroke-width="1.5" />
      ${isShirt ? `<rect x="0" y="80" width="46" height="16" rx="2" fill="${cuffColor}" />` : ''}
    </g>

    <!-- Right Arm -->
    <g transform="translate(-102, 76)">
      <rect x="0" y="0" width="46" height="96" rx="6" fill="${armFill}" stroke="#222" stroke-width="1.5" />
      ${isShirt ? `<rect x="0" y="80" width="46" height="16" rx="2" fill="${cuffColor}" />` : ''}
    </g>

    <!-- Torso -->
    <g transform="translate(-50, 76)">
      <rect x="0" y="0" width="100" height="96" rx="4" fill="${torsoFill}" stroke="#222" stroke-width="1.5" />
      ${spec.shading ? `<rect x="0" y="0" width="100" height="96" rx="4" fill="url(#fold-shade-v)" />` : ''}
      ${
        isShirt || isTshirt
          ? renderNeckDetails(spec, { id: 'torso_front', label: '', x: -14, y: 0, w: 128, h: 96 })
          : ''
      }
      ${
        isShirt || isTshirt
          ? renderPocketDetails(spec, { id: 'torso_front', label: '', x: -14, y: 0, w: 128, h: 96 })
          : ''
      }
      ${
        isTshirt
          ? `<circle cx="50" cy="48" r="24" fill="${accentColor}" />
             <path d="M40 58 L50 38 L60 58 Z" fill="${cuffColor}" />`
          : ''
      }
    </g>

    <!-- Left Leg -->
    <g transform="translate(4, 176)">
      <rect x="0" y="0" width="46" height="104" rx="4" fill="${pantsFill}" stroke="#222" stroke-width="1.5" />
      ${isPants ? `<rect x="0" y="88" width="46" height="16" rx="2" fill="${cuffColor}" />` : ''}
    </g>

    <!-- Right Leg -->
    <g transform="translate(-50, 176)">
      <rect x="0" y="0" width="46" height="104" rx="4" fill="${pantsFill}" stroke="#222" stroke-width="1.5" />
      ${isPants ? `<rect x="0" y="88" width="46" height="16" rx="2" fill="${cuffColor}" />` : ''}
    </g>

    <!-- Shadow under avatar -->
    <ellipse cx="0" cy="286" rx="80" ry="10" fill="#000000" opacity="0.35" />
  </g>
</svg>`;

  return { svg };
}
