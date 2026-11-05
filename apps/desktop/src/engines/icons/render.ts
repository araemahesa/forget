import {
  hasBlockingIconErrors,
  validateIconSpec,
  type IconSpec,
  type IconGlyph,
  type IconShape,
  type ValidationIssue,
} from "@forgekit/contracts";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getShapeMarkup(shape: IconShape, spec: IconSpec): string {
  if (shape === "none") return "";
  const fill = spec.style === "solid" ? spec.secondaryColor : "none";
  const fillOpacity = spec.style === "solid" ? "0.15" : "0";
  const stroke = spec.primaryColor;
  const sw = spec.strokeWidth;

  switch (shape) {
    case "circle":
      return `<circle cx="32" cy="32" r="28" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case "square":
      return `<rect x="5" y="5" width="54" height="54" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case "rounded":
      return `<rect x="5" y="5" width="54" height="54" rx="14" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case "squircle":
      return `<rect x="4" y="4" width="56" height="56" rx="20" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>`;
    case "hexagon":
      return `<polygon points="32,4 57,18 57,46 32,60 7,46 7,18" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case "shield":
      return `<path d="M12 8 h40 v22 c0 15 -20 26 -20 26 c0 0 -20 -11 -20 -26 Z" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  }
}

function getGlyphMarkup(glyph: IconGlyph, spec: IconSpec): string {
  const isSolid = spec.style === "solid";
  const isDuotone = spec.style === "duotone";
  const stroke = spec.primaryColor;
  const fill = isSolid ? spec.primaryColor : isDuotone ? spec.secondaryColor : "none";
  const fillOpacity = isDuotone ? "0.35" : isSolid ? "1" : "0";
  const sw = spec.strokeWidth;
  const common = `stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;

  switch (glyph) {
    case "sword":
      return [
        `<path d="M44 8 l12 12 -24 24 -6 -6 24 -24 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<line x1="22" y1="42" x2="16" y2="48" ${common}/>`,
        `<line x1="18" y1="36" x2="30" y2="48" ${common}/>`,
        `<circle cx="14" cy="50" r="3" fill="${stroke}"/>`,
      ].join("");
    case "shield":
      return [
        `<path d="M16 14 h32 v18 c0 12 -16 22 -16 22 s-16 -10 -16 -22 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<path d="M32 18 v32 M22 28 h20" ${common}/>`,
      ].join("");
    case "bow":
      return [
        `<path d="M16 16 c24 4 24 28 0 32" fill="none" ${common}/>`,
        `<line x1="16" y1="16" x2="16" y2="48" stroke="${spec.secondaryColor}" stroke-width="1.5" stroke-dasharray="2 2"/>`,
        `<line x1="12" y1="32" x2="44" y2="32" ${common}/>`,
        `<path d="M40 28 l4 4 -4 4" fill="none" ${common}/>`,
      ].join("");
    case "axe":
      return [
        `<line x1="18" y1="52" x2="42" y2="16" ${common}/>`,
        `<path d="M36 18 c8 -8 18 -2 18 10 c-6 4 -12 2 -18 -10 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
      ].join("");
    case "skull":
      return [
        `<path d="M18 28 c0 -8 6 -14 14 -14 s14 6 14 14 c0 6 -4 10 -6 12 v8 h-16 v-8 c-2 -2 -6 -6 -6 -12 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<circle cx="26" cy="28" r="3" fill="${stroke}"/>`,
        `<circle cx="38" cy="28" r="3" fill="${stroke}"/>`,
        `<line x1="28" y1="44" x2="28" y2="48" ${common}/>`,
        `<line x1="36" y1="44" x2="36" y2="48" ${common}/>`,
      ].join("");
    case "potion":
      return [
        `<path d="M28 12 h8 v6 h-8 Z" fill="${stroke}" ${common}/>`,
        `<path d="M30 18 h4 v6 l12 18 c3 5 0 10 -6 10 h-16 c-6 0 -9 -5 -6 -10 l12 -18 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<circle cx="32" cy="42" r="3" fill="${spec.secondaryColor}"/>`,
        `<circle cx="28" cy="46" r="2" fill="${spec.secondaryColor}"/>`,
      ].join("");
    case "coin":
      return [
        `<circle cx="32" cy="32" r="20" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<circle cx="32" cy="32" r="14" fill="none" stroke="${spec.secondaryColor}" stroke-width="1.5" stroke-dasharray="3 3"/>`,
        `<path d="M32 24 v16 M28 28 h8 c0 4 -8 2 -8 6 h8" ${common}/>`,
      ].join("");
    case "gem":
      return [
        `<polygon points="20,18 44,18 52,28 32,50 12,28" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<line x1="12" y1="28" x2="52" y2="28" stroke="${stroke}" stroke-width="1.5"/>`,
        `<line x1="24" y1="28" x2="32" y2="50" stroke="${stroke}" stroke-width="1.5"/>`,
        `<line x1="40" y1="28" x2="32" y2="50" stroke="${stroke}" stroke-width="1.5"/>`,
        `<line x1="20" y1="18" x2="24" y2="28" stroke="${stroke}" stroke-width="1.5"/>`,
        `<line x1="44" y1="18" x2="40" y2="28" stroke="${stroke}" stroke-width="1.5"/>`,
      ].join("");
    case "chest":
      return [
        `<rect x="14" y="26" width="36" height="24" rx="4" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<path d="M14 26 c0 -8 8 -12 18 -12 s18 4 18 12 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<line x1="14" y1="26" x2="50" y2="26" ${common}/>`,
        `<circle cx="32" cy="34" r="3" fill="${stroke}"/>`,
        `<line x1="32" y1="37" x2="32" y2="41" ${common}/>`,
      ].join("");
    case "key":
      return [
        `<circle cx="24" cy="24" r="10" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<circle cx="24" cy="24" r="4" fill="none" ${common}/>`,
        `<line x1="31" y1="31" x2="48" y2="48" ${common}/>`,
        `<line x1="43" y1="43" x2="47" y2="39" ${common}/>`,
        `<line x1="47" y1="47" x2="51" y2="43" ${common}/>`,
      ].join("");
    case "bag":
      return [
        `<path d="M20 24 c0 -6 4 -10 12 -10 s12 4 12 10 l6 22 c0 6 -6 8 -18 8 s-18 -2 -18 -8 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<line x1="22" y1="24" x2="42" y2="24" stroke="${spec.secondaryColor}" stroke-width="2.5"/>`,
        `<circle cx="32" cy="36" r="4" fill="${spec.secondaryColor}"/>`,
      ].join("");
    case "heart":
      return [
        `<path d="M32 48 c-16 -10 -20 -20 -20 -26 c0 -6 5 -10 10 -10 c5 0 8 4 10 7 c2 -3 5 -7 10 -7 c5 0 10 4 10 10 c0 6 -4 16 -20 26 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
      ].join("");
    case "star":
      return [
        `<polygon points="32,10 37,24 52,24 40,34 44,48 32,40 20,48 24,34 12,24 27,24" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
      ].join("");
    case "spark":
      return [
        `<path d="M32 8 c1 12 11 22 23 23 c-12 1 -22 11 -23 23 c-1 -12 -11 -22 -23 -23 c12 -1 22 -11 23 -23 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
      ].join("");
    case "flame":
      return [
        `<path d="M32 10 c6 8 16 18 16 28 c0 9 -7 16 -16 16 s-16 -7 -16 -16 c0 -8 6 -14 10 -18 c0 6 3 10 6 10 c0 -8 0 -14 0 -20 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<path d="M32 36 c-3 0 -5 2 -5 5 c0 4 3 7 5 7 s5 -3 5 -7 c0 -3 -2 -5 -5 -5 Z" fill="${spec.secondaryColor}"/>`,
      ].join("");
    case "bolt":
      return [
        `<polygon points="34,10 18,32 30,32 26,54 46,28 34,28" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
      ].join("");
    case "compass":
      return [
        `<circle cx="32" cy="32" r="20" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<polygon points="32,18 36,32 32,46 28,32" fill="${stroke}" stroke="none"/>`,
        `<polygon points="32,18 36,32 32,32" fill="${spec.secondaryColor}"/>`,
        `<circle cx="32" cy="32" r="3" fill="#FFFFFF"/>`,
      ].join("");
    case "crown":
      return [
        `<path d="M14 44 l4 -22 l8 12 l6 -16 l6 16 l8 -12 l4 22 Z" fill="${fill}" fill-opacity="${fillOpacity}" ${common}/>`,
        `<circle cx="18" cy="20" r="2.5" fill="${spec.secondaryColor}"/>`,
        `<circle cx="32" cy="14" r="2.5" fill="${spec.secondaryColor}"/>`,
        `<circle cx="46" cy="20" r="2.5" fill="${spec.secondaryColor}"/>`,
        `<rect x="14" y="42" width="36" height="4" rx="1" fill="${stroke}"/>`,
      ].join("");
  }
}

export function renderIconSvg(spec: IconSpec): { svg: string; issues: ValidationIssue[] } {
  const issues = validateIconSpec(spec);
  if (hasBlockingIconErrors(issues)) {
    return { svg: "", issues };
  }

  const bgRect = spec.background !== "transparent"
    ? `<rect width="64" height="64" rx="8" fill="${spec.background}"/>`
    : "";

  const scale = (64 - 2 * spec.padding) / 64;
  const offset = spec.padding;

  const shapeMarkup = getShapeMarkup(spec.shape, spec);
  const glyphMarkup = getGlyphMarkup(spec.glyph, spec);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.size}" height="${spec.size}" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(spec.name)}">`,
    bgRect,
    shapeMarkup,
    `<g transform="translate(${offset}, ${offset}) scale(${scale})">`,
    glyphMarkup,
    "</g>",
    "</svg>",
  ].join("");

  return { svg, issues };
}
