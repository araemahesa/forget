import { describe, expect, it } from 'vitest';
import type { SkyboxRecipe } from '@forgekit/contracts';
import {
  generateRobloxSkyScript,
  renderAllSkyboxFaces,
  renderCubeFaceSvg,
  renderPanoramaStripSvg,
  renderSkyboxCubeNetSvg,
  skyboxPresetsData,
} from './render';

const testRecipe: SkyboxRecipe = {
  name: 'Langit Senja Tropis',
  ...skyboxPresetsData.sunset,
  seed: 777,
};

describe('Skybox Engine', () => {
  it('renders all 6 cube faces with SVG strings', () => {
    const faces = renderAllSkyboxFaces(testRecipe);
    expect(Object.keys(faces)).toEqual(['ft', 'bk', 'lf', 'rt', 'up', 'dn']);
    expect(faces.ft).toContain('<svg');
    expect(faces.ft).toContain('viewBox="0 0 512 512"');
    expect(faces.up).toContain('<radialGradient');
    expect(faces.dn).toContain('<radialGradient');
    expect(faces.bk).toContain('<linearGradient');
  });

  it('renders single face SVG correctly', () => {
    const svg = renderCubeFaceSvg(testRecipe, 'ft', 256);
    expect(svg).toContain('width="256"');
    expect(svg).toContain('height="256"');
    expect(svg).toContain(testRecipe.topColor);
    expect(svg).toContain(testRecipe.horizonColor);
  });

  it('renders cube net SVG with all 6 faces placed in 4x3 grid', () => {
    const netSvg = renderSkyboxCubeNetSvg(testRecipe, 100);
    expect(netSvg).toContain('viewBox="0 0 400 300"');
    expect(netSvg).toContain('UP (Top)');
    expect(netSvg).toContain('FT (Front)');
    expect(netSvg).toContain('LF (Left)');
    expect(netSvg).toContain('RT (Right)');
    expect(netSvg).toContain('BK (Back)');
    expect(netSvg).toContain('DN (Bottom)');
  });

  it('renders 360 panorama strip SVG', () => {
    const stripSvg = renderPanoramaStripSvg(testRecipe, 640, 160);
    expect(stripSvg).toContain('viewBox="0 0 640 160"');
    expect(stripSvg).toContain(testRecipe.horizonColor);
  });

  it('generates Roblox Luau Sky instance setup script', () => {
    const script = generateRobloxSkyScript(testRecipe);
    expect(script).toContain('Lighting:FindFirstChildOfClass("Sky")');
    expect(script).toContain('Lighting.ClockTime = 17.8');
    expect(script).toContain(testRecipe.horizonColor);
    expect(script).toContain(testRecipe.sunColor);
  });
});
