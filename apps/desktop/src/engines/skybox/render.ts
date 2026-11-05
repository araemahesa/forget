import type { CubeFace, SkyboxRecipe } from '@forgekit/contracts';
import { validateSkyboxRecipe } from '@forgekit/contracts';

export { skyboxPresetsData } from '@forgekit/contracts';

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderCubeFaceSvg(recipe: SkyboxRecipe, face: CubeFace, size = 512): string {
  if (validateSkyboxRecipe(recipe).length || !Number.isInteger(size) || size < 1 || size > 1024) {
    throw new Error('Spesifikasi skybox tidak sah.');
  }
  const prng = mulberry32(recipe.seed + faceSeedOffset(face));
  const gradId = `sky-grad-${face}-${recipe.seed}`;
  const sunGradId = `sun-grad-${face}-${recipe.seed}`;

  let backgroundDef = '';
  let celestialBody = '';
  let stars = '';
  let clouds = '';

  // Background gradient based on face type
  if (face === 'up') {
    // Zenith / Top face: radial from topColor in center to darker topColor at edges
    backgroundDef = `
      <radialGradient id="${gradId}" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="${recipe.topColor}" />
        <stop offset="100%" stop-color="${recipe.topColor}" stop-opacity="0.9" />
      </radialGradient>`;
  } else if (face === 'dn') {
    // Nadir / Bottom face: bottomColor
    backgroundDef = `
      <radialGradient id="${gradId}" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="${recipe.bottomColor}" />
        <stop offset="100%" stop-color="${recipe.bottomColor}" stop-opacity="0.95" />
      </radialGradient>`;
  } else {
    // Lateral faces (ft, bk, lf, rt): vertical gradient from topColor -> horizonColor -> bottomColor
    // Horizon is at 55% from top
    backgroundDef = `
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${recipe.topColor}" />
        <stop offset="52%" stop-color="${recipe.horizonColor}" />
        <stop offset="58%" stop-color="${recipe.horizonColor}" />
        <stop offset="100%" stop-color="${recipe.bottomColor}" />
      </linearGradient>`;
  }

  // Celestial body (Sun or Moon) position calculation
  const sunPos = getSunPositionOnFace(face, recipe.sunElevation, recipe.sunAzimuth, size);
  if (sunPos) {
    const isNight = recipe.timeOfDay < 5 || recipe.timeOfDay > 19;
    const radius = isNight ? size * 0.045 : size * 0.065;
    const glowRadius = radius * 3.5;

    celestialBody = `
      <defs>
        <radialGradient id="${sunGradId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${recipe.sunColor}" stop-opacity="1" />
          <stop offset="40%" stop-color="${recipe.sunColor}" stop-opacity="0.8" />
          <stop offset="100%" stop-color="${recipe.horizonColor}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="${sunPos.x.toFixed(1)}" cy="${sunPos.y.toFixed(1)}" r="${glowRadius.toFixed(1)}" fill="url(#${sunGradId})" />
      <circle cx="${sunPos.x.toFixed(1)}" cy="${sunPos.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${recipe.sunColor}" />`;
  }

  // Stars (if starDensity > 0 and face is not 'dn')
  if (recipe.starDensity > 0 && face !== 'dn') {
    const starCount = Math.floor(recipe.starDensity * (face === 'up' ? 80 : 40));
    let starElements = '';
    for (let i = 0; i < starCount; i++) {
      const sx = (prng() * size).toFixed(1);
      const maxY = face === 'up' ? size : size * 0.5;
      const sy = (prng() * maxY).toFixed(1);
      const r = (prng() * 1.5 + 0.5).toFixed(1);
      const opacity = (prng() * 0.75 + 0.25).toFixed(2);
      starElements += `<circle cx="${sx}" cy="${sy}" r="${r}" fill="#ffffff" opacity="${opacity}" />`;
    }
    stars = `<g class="stars">${starElements}</g>`;
  }

  // Clouds (if cloudCover > 0 and face is lateral or up)
  if (recipe.cloudCover > 0 && face !== 'dn') {
    const cloudCount = Math.floor(recipe.cloudCover * (face === 'up' ? 6 : 4));
    let cloudElements = '';
    for (let i = 0; i < cloudCount; i++) {
      const cx = prng() * size;
      const cy = face === 'up' ? prng() * size : size * 0.35 + prng() * (size * 0.18);
      const rx = size * (0.15 + prng() * 0.2);
      const ry = rx * (0.28 + prng() * 0.15);
      const opacity = (recipe.cloudCover * (0.25 + prng() * 0.35)).toFixed(2);
      cloudElements += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${recipe.horizonColor}" opacity="${opacity}" />`;
    }
    clouds = `<g class="clouds" filter="blur(4px)">${cloudElements}</g>`;
  }

  // Haze layer near horizon
  let hazeLayer = '';
  if (recipe.haze > 0 && face !== 'up' && face !== 'dn') {
    const hazeOpacity = (recipe.haze * 0.45).toFixed(2);
    hazeLayer = `<rect x="0" y="${(size * 0.46).toFixed(1)}" width="${size}" height="${(size * 0.15).toFixed(1)}" fill="${recipe.horizonColor}" opacity="${hazeOpacity}" filter="blur(6px)" />`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    ${backgroundDef}
  </defs>
  <rect width="${size}" height="${size}" fill="url(#${gradId})" />
  ${stars}
  ${celestialBody}
  ${clouds}
  ${hazeLayer}
</svg>`;
}

function faceSeedOffset(face: CubeFace): number {
  switch (face) {
    case 'ft': return 100;
    case 'bk': return 200;
    case 'lf': return 300;
    case 'rt': return 400;
    case 'up': return 500;
    case 'dn': return 600;
  }
}

function getSunPositionOnFace(
  face: CubeFace,
  elevationDeg: number,
  azimuthDeg: number,
  size: number
): { x: number; y: number } | null {
  if (elevationDeg < -15) return null;

  const az = ((azimuthDeg % 360) + 360) % 360;

  if (face === 'up') {
    if (elevationDeg < 35) return null;
    const r = ((90 - elevationDeg) / 55) * (size * 0.42);
    const rad = (az * Math.PI) / 180;
    return {
      x: size / 2 + Math.sin(rad) * r,
      y: size / 2 - Math.cos(rad) * r,
    };
  }

  if (face === 'dn') return null;

  let faceCenterAz = 0;
  if (face === 'ft') faceCenterAz = 0;
  else if (face === 'rt') faceCenterAz = 90;
  else if (face === 'bk') faceCenterAz = 180;
  else if (face === 'lf') faceCenterAz = 270;

  let diff = az - faceCenterAz;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  if (Math.abs(diff) > 50) return null;

  const x = size / 2 + (diff / 45) * (size / 2);
  const yHorizon = size * 0.54;
  const y = yHorizon - (elevationDeg / 45) * (size * 0.45);

  if (x < -size * 0.1 || x > size * 1.1 || y < -size * 0.1 || y > size) return null;

  return { x, y };
}

export function renderSkyboxCubeNetSvg(recipe: SkyboxRecipe, cell = 120): string {
  const width = cell * 4;
  const height = cell * 3;

  const ftSvg = renderCubeFaceSvg(recipe, 'ft', cell);
  const bkSvg = renderCubeFaceSvg(recipe, 'bk', cell);
  const lfSvg = renderCubeFaceSvg(recipe, 'lf', cell);
  const rtSvg = renderCubeFaceSvg(recipe, 'rt', cell);
  const upSvg = renderCubeFaceSvg(recipe, 'up', cell);
  const dnSvg = renderCubeFaceSvg(recipe, 'dn', cell);

  const getInner = (svg: string) => svg.replace(/<svg[^>]*>|<\/svg>/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <!-- Top Face (UP) at row 0, col 1 -->
    <g transform="translate(${cell}, 0)">
      <rect width="${cell}" height="${cell}" fill="#101216" />
      ${getInner(upSvg)}
      <text x="${cell / 2}" y="20" fill="#ffffff" opacity="0.75" font-size="11" font-weight="600" text-anchor="middle">UP (Top)</text>
    </g>

    <!-- Lateral Faces at row 1 -->
    <g transform="translate(0, ${cell})">
      <rect width="${cell}" height="${cell}" fill="#101216" />
      ${getInner(lfSvg)}
      <text x="${cell / 2}" y="${cell - 10}" fill="#ffffff" opacity="0.75" font-size="11" font-weight="600" text-anchor="middle">LF (Left)</text>
    </g>

    <g transform="translate(${cell}, ${cell})">
      <rect width="${cell}" height="${cell}" fill="#101216" />
      ${getInner(ftSvg)}
      <text x="${cell / 2}" y="${cell - 10}" fill="#ffffff" opacity="0.75" font-size="11" font-weight="600" text-anchor="middle">FT (Front)</text>
    </g>

    <g transform="translate(${cell * 2}, ${cell})">
      <rect width="${cell}" height="${cell}" fill="#101216" />
      ${getInner(rtSvg)}
      <text x="${cell / 2}" y="${cell - 10}" fill="#ffffff" opacity="0.75" font-size="11" font-weight="600" text-anchor="middle">RT (Right)</text>
    </g>

    <g transform="translate(${cell * 3}, ${cell})">
      <rect width="${cell}" height="${cell}" fill="#101216" />
      ${getInner(bkSvg)}
      <text x="${cell / 2}" y="${cell - 10}" fill="#ffffff" opacity="0.75" font-size="11" font-weight="600" text-anchor="middle">BK (Back)</text>
    </g>

    <!-- Bottom Face (DN) at row 2, col 1 -->
    <g transform="translate(${cell}, ${cell * 2})">
      <rect width="${cell}" height="${cell}" fill="#101216" />
      ${getInner(dnSvg)}
      <text x="${cell / 2}" y="${cell - 10}" fill="#ffffff" opacity="0.75" font-size="11" font-weight="600" text-anchor="middle">DN (Bottom)</text>
    </g>

    <!-- Outlines and seams -->
    <g stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none">
      <rect x="${cell}" y="0" width="${cell}" height="${cell}" />
      <rect x="0" y="${cell}" width="${cell * 4}" height="${cell}" />
      <line x1="${cell}" y1="${cell}" x2="${cell}" y2="${cell * 2}" />
      <line x1="${cell * 2}" y1="${cell}" x2="${cell * 2}" y2="${cell * 2}" />
      <line x1="${cell * 3}" y1="${cell}" x2="${cell * 3}" y2="${cell * 2}" />
      <rect x="${cell}" y="${cell * 2}" width="${cell}" height="${cell}" />
    </g>
  </svg>`;
}

export function renderPanoramaStripSvg(recipe: SkyboxRecipe, width = 640, height = 160): string {
  const cellWidth = width / 4;
  const lfSvg = renderCubeFaceSvg(recipe, 'lf', height);
  const ftSvg = renderCubeFaceSvg(recipe, 'ft', height);
  const rtSvg = renderCubeFaceSvg(recipe, 'rt', height);
  const bkSvg = renderCubeFaceSvg(recipe, 'bk', height);

  const getInner = (svg: string) => svg.replace(/<svg[^>]*>|<\/svg>/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <g transform="translate(0, 0)">${getInner(lfSvg)}</g>
    <g transform="translate(${cellWidth}, 0)">${getInner(ftSvg)}</g>
    <g transform="translate(${cellWidth * 2}, 0)">${getInner(rtSvg)}</g>
    <g transform="translate(${cellWidth * 3}, 0)">${getInner(bkSvg)}</g>
    <line x1="0" y1="${height * 0.54}" x2="${width}" y2="${height * 0.54}" stroke="${recipe.horizonColor}" stroke-dasharray="3 3" stroke-opacity="0.4" />
  </svg>`;
}

export function renderAllSkyboxFaces(recipe: SkyboxRecipe): Record<CubeFace, string> {
  return {
    ft: renderCubeFaceSvg(recipe, 'ft', recipe.resolution),
    bk: renderCubeFaceSvg(recipe, 'bk', recipe.resolution),
    lf: renderCubeFaceSvg(recipe, 'lf', recipe.resolution),
    rt: renderCubeFaceSvg(recipe, 'rt', recipe.resolution),
    up: renderCubeFaceSvg(recipe, 'up', recipe.resolution),
    dn: renderCubeFaceSvg(recipe, 'dn', recipe.resolution),
  };
}

export function generateRobloxSkyScript(recipe: SkyboxRecipe): string {
  if (validateSkyboxRecipe(recipe).length) throw new Error('Spesifikasi skybox tidak sah.');
  return `-- Generated by ForgeKit Studio (Skybox Generator F11)
-- Recipe: ${recipe.name} (${recipe.preset})

local Lighting = game:GetService("Lighting")

local sky = Lighting:FindFirstChildOfClass("Sky")
if not sky then
    sky = Instance.new("Sky")
    sky.Name = "ForgeKitSky"
    sky.Parent = Lighting
end

-- Skybox properties
sky.CelestialBodiesShown = true
sky.SunAngularSize = ${recipe.timeOfDay >= 6 && recipe.timeOfDay <= 18 ? '11' : '0'}
sky.MoonAngularSize = ${recipe.timeOfDay < 6 || recipe.timeOfDay > 18 ? '11' : '0'}
sky.StarCount = ${Math.floor(recipe.starDensity * 3000)}

-- Lighting environmental properties
Lighting.ClockTime = ${recipe.timeOfDay.toFixed(1)}
Lighting.GeographicLatitude = 23.5
Lighting.OutdoorAmbient = Color3.fromHex("${recipe.horizonColor}")
Lighting.ColorShift_Top = Color3.fromHex("${recipe.sunColor}")
Lighting.ColorShift_Bottom = Color3.fromHex("${recipe.bottomColor}")
Lighting.ExposureCompensation = ${recipe.haze > 0.4 ? '0.2' : '0.0'}

print(${JSON.stringify(`[ForgeKit] Lighting preset applied: ${recipe.name}`)})
`;
}
