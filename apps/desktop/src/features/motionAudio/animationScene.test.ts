import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { eulerXYZToQuat, evaluateClip, migrateAnimationRecipe, type ObjectAnimationDocument } from '@forgekit/contracts';
import { applyPose, buildAnimationScene, exportAnimationGlb, footSlideCheck } from './animationScene';

const door: ObjectAnimationDocument = {
  schemaVersion: 2, name: 'Pintu', targetEngine: 'roblox', units: 'stud', coordinateSystem: 'y-up-right-handed',
  rotationConvention: 'quaternion-xyzw-local', timeUnit: 'seconds', qualityProfile: 'high_polish', animationMode: 'object',
  object: { parts: [
    { id: 'frame', name: 'Kusen', parentId: null, shape: 'block', size: [0.5, 8, 0.5], color: '#553311', pivot: [0, 4, 0], offset: [0, 0, 0], restRotation: [0, 0, 0, 1] },
    { id: 'panel', name: 'Daun', parentId: 'frame', shape: 'block', size: [4, 7, 0.3], color: '#885522', pivot: [0.25, -0.5, 0], offset: [2, 0, 0], restRotation: [0, 0, 0, 1] },
  ] },
  motionIntent: { originalPrompt: 'Buka pintu 100 derajat', assumptions: [], requirements: [{ id: 'open', kind: 'action', text: 'Membuka', excerpt: 'Buka pintu', binding: { clipId: 'open', targetIds: ['panel'], window: [0, 1.2] } }] },
  clips: [{ id: 'open', name: 'Buka', durationSeconds: 1.2, loopMode: 'once', markers: [], tracks: [
    { targetId: 'panel', property: 'rotation', interpolation: 'smooth', keys: [{ timeSeconds: 0, value: [0, 0, 0, 1] }, { timeSeconds: 0.6, value: eulerXYZToQuat([0, 55, 0]) }, { timeSeconds: 1.2, value: eulerXYZToQuat([0, 100, 0]) }] },
  ] }],
};

describe('animation scene', () => {
  it('keeps the door panel on its hinge and never accumulates drift', () => {
    const scene = buildAnimationScene(door);
    const panel = scene.nodes.get('panel')!.node;
    const hinge = () => { scene.group.updateMatrixWorld(true); return panel.getWorldPosition(new THREE.Vector3()); };
    const rest = hinge();
    for (let i = 0; i < 200; i++) applyPose(scene, evaluateClip(door.clips[0], (i % 37) / 30));
    applyPose(scene, evaluateClip(door.clips[0], 1.2));
    expect(hinge().distanceTo(rest)).toBeLessThan(1e-9); // rotation happens around the pivot
    applyPose(scene, evaluateClip(door.clips[0], 0));
    expect(panel.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    scene.dispose();
  });

  it('exports every clip to GLB and reads the same tracks back', async () => {
    const result = await exportAnimationGlb(door);
    expect(result.verified).toBe(true);
    expect(result.verification[0]).toContain('dibaca ulang');
    expect(new TextDecoder().decode(result.bytes.slice(0, 4))).toBe('glTF');
  });

  it('reports foot sliding only from measured foot motion on the reference rig', () => {
    const idle = migrateAnimationRecipe({ name: 'Idle', rigType: 'R15', duration: 2, loop: true, priority: 'Idle', keyframes: [
      { time: 0, jointRotations: { UpperTorso: [0, 0, 0] } }, { time: 1, jointRotations: { UpperTorso: [3, 0, 0] } }, { time: 2, jointRotations: { UpperTorso: [0, 0, 0] } },
    ] });
    const scene = buildAnimationScene(idle);
    expect(footSlideCheck(idle, scene, idle.clips[0]).status).toBe('pass');
    // Twisting the hips while the feet stay on the floor drags both planted feet sideways.
    const twist = migrateAnimationRecipe({ name: 'Putar pinggul', rigType: 'R15', duration: 1, loop: false, priority: 'Action', keyframes: [
      { time: 0, jointRotations: { LowerTorso: [0, 0, 0] } }, { time: 1, jointRotations: { LowerTorso: [0, 30, 0] } },
    ] });
    const check = footSlideCheck(twist, buildAnimationScene(twist), twist.clips[0]);
    expect(check.status).toBe('warn');
    expect(check.detail).toMatch(/LeftFoot|RightFoot/);
    scene.dispose();
  });
});
