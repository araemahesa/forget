import { describe, expect, it } from 'vitest';
import type { ClothingSpec } from '@forgekit/contracts';
import {
  renderAvatarPreviewSvg,
  renderClothingTemplateSvg,
  shirtBoxes,
  pantsBoxes,
} from './render';

const testShirt: ClothingSpec = {
  schemaVersion: 1,
  name: 'Kemeja Formal',
  kind: 'shirt',
  baseColor: '#2C3E50',
  accentColor: '#E74C3C',
  pattern: 'stripes',
  neckStyle: 'collar',
  pocket: true,
  cuffColor: '#1A252F',
  shading: true,
  templateGuide: true,
};

const testPants: ClothingSpec = {
  schemaVersion: 1,
  name: 'Celana Jeans Denim',
  kind: 'pants',
  baseColor: '#1B4F72',
  accentColor: '#F39C12',
  pattern: 'denim',
  neckStyle: 'round',
  pocket: false,
  cuffColor: '#154360',
  shading: true,
  templateGuide: false,
};

const testTshirt: ClothingSpec = {
  schemaVersion: 1,
  name: 'Kaos Logo Retro',
  kind: 'tshirt',
  baseColor: '#17202A',
  accentColor: '#FF405F',
  pattern: 'solid',
  neckStyle: 'crew',
  pocket: false,
  cuffColor: '#FFFFFF',
  shading: false,
  templateGuide: true,
};

describe('Clothing render engine', () => {
  it('renders a valid 585x559 shirt template with all body boxes', () => {
    const result = renderClothingTemplateSvg(testShirt);
    expect(result.issues).toEqual([]);
    expect(result.svg).toContain('viewBox="0 0 585 559"');
    expect(result.svg).toContain('id="box-torso_front"');
    expect(result.svg).toContain('id="box-rarm_front"');
    expect(result.svg).toContain('id="box-larm_front"');
    expect(result.svg).toContain('TORSO FRONT');
  });

  it('renders a valid 585x559 pants template with leg boxes', () => {
    const result = renderClothingTemplateSvg(testPants);
    expect(result.issues).toEqual([]);
    expect(result.svg).toContain('viewBox="0 0 585 559"');
    expect(result.svg).toContain('id="box-pelvis_front"');
    expect(result.svg).toContain('id="box-rleg_front"');
    expect(result.svg).toContain('id="box-lleg_front"');
  });

  it('renders a 512x512 T-Shirt graphic decal', () => {
    const result = renderClothingTemplateSvg(testTshirt);
    expect(result.issues).toEqual([]);
    expect(result.svg).toContain('viewBox="0 0 512 512"');
    expect(result.svg).toContain('width="512" height="512"');
  });

  it('renders an avatar showcase preview correctly', () => {
    const result = renderAvatarPreviewSvg(testShirt);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('viewBox="0 0 320 380"');
    expect(result.svg).toContain('circle cx="-14" cy="32"'); // face details
  });

  it('verifies shirt and pants box counts match official specs', () => {
    // 6 torso faces + 6 right arm faces + 6 left arm faces = 18 boxes
    expect(shirtBoxes.length).toBe(18);
    // 6 pelvis faces + 6 right leg faces + 6 left leg faces = 18 boxes
    expect(pantsBoxes.length).toBe(18);
  });
});
