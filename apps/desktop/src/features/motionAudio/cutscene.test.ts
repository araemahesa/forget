import { describe, expect, it } from 'vitest';
import { validateCutsceneRecipe, type CutsceneRecipe } from '@forgekit/contracts';
import { buildCutscenePreview, cameraEasing, cutsceneLuau, sampleCutscene } from './cutscene';
import { disposeGeometry } from '../create/geometry';

const recipe: CutsceneRecipe = {
  title: 'Camera', duration: 4, loop: false,
  keyframes: [
    { time: 0, position: [0, 0, 20], lookAt: [0, 0, 0], fov: 60, easing: 'Linear' },
    { time: 2, position: [10, 0, 20], lookAt: [0, 0, 0], fov: 80, easing: 'Cubic' },
  ],
};
describe('camera preview and LocalScript', () => {
  it('samples recipe positions, quaternion orientation, FOV, easing and terminal hold', () => {
    expect(validateCutsceneRecipe(recipe)).toEqual([]);
    expect(sampleCutscene(recipe, .5).position.x).toBeCloseTo(.625);
    expect(sampleCutscene(recipe, 1).position.x).toBe(5);
    expect(sampleCutscene(recipe, 1).fov).toBe(70);
    expect(sampleCutscene(recipe, 4).position.x).toBe(10);
    expect(sampleCutscene(recipe, -1).position.x).toBe(0);
    expect(sampleCutscene(recipe, 1).quaternion.length()).toBeCloseTo(1);
    for (const style of ['Linear', 'Sine', 'Quad', 'Cubic', 'Quint'] as const) {
      expect(cameraEasing(style, 0)).toBeCloseTo(0);
      expect(cameraEasing(style, .5)).toBeCloseTo(.5);
      expect(cameraEasing(style, 1)).toBeCloseTo(1);
    }
    const preview = buildCutscenePreview(recipe);
    preview.update(1);
    expect(preview.camera.position.x).toBe(5);
    expect(preview.camera.fov).toBe(70);
    const line = preview.group.getObjectByName('CameraPath')!;
    expect(line.type).toBe('Line');
    disposeGeometry(preview.group);
  });
  it('rejects invalid poses before preview/export and exports explicit cleanup using recipe coordinates', () => {
    expect(validateCutsceneRecipe(null)).not.toEqual([]);
    for (const patch of [{ position: [0, 0, 0] }, { fov: NaN }, { time: 3 }, { easing: 'exec' }, { extra: true }]) {
      const invalid = { ...recipe, keyframes: [{ ...recipe.keyframes[0], ...patch }, recipe.keyframes[1]] };
      expect(() => buildCutscenePreview(invalid as CutsceneRecipe)).toThrow();
    }
    const script = cutsceneLuau(recipe);
    expect(script).toContain('Vector3.new(10, 0, 20)');
    expect(script).toContain('Enum.EasingDirection.InOut');
    expect(script).toContain('script.Destroying:Connect(stop)');
    expect(script).toContain('connection:Disconnect()');
    expect(script).toContain('camera.CameraSubject, camera.CameraType = previousSubject, previousType');
  });
});
