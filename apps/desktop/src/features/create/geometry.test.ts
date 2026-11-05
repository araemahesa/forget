import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { model3dRequiresMesh, model3dSurface, rigJoints, validateAnimationRecipe, validateModel3dRecipe, type AnimationRecipe, type Model3dRecipe } from '@forgekit/contracts';
import { buildModel, buildReferenceRig, disposeGeometry, evaluateMotion, exportGeometry, modelStatistics, motionClip } from './geometry';
import shapeCases from '../../../../../packages/contracts/src/model3d-shape-cases.json';
import profileCases from '../../../../../packages/contracts/src/model3d-profile-cases.json';

const model: Model3dRecipe = {
  name: 'Test geometry', category: 'prop', seed: 0, exportFormat: 'glb',
  parts: ['cube', 'sphere', 'cylinder', 'wedge', 'cone', 'torus'].map((primitive, i) => ({
    id: `p${i}`, name: primitive, primitive: primitive as Model3dRecipe['parts'][number]['primitive'],
    position: [i * 3, 2, 0], size: [2, 3, 1], rotation: [0, 0, 0], color: '#d6002b', material: 'Metal',
  })),
};
describe('procedural geometry and motion exports', () => {
  it.each(shapeCases)('validates reference shapes: $name', fixture => {
    const {name,valid,...shape}=fixture;
    const recipe={...model,exportFormat:'blend',parts:[{...model.parts[0],...shape}]};
    expect(validateModel3dRecipe(recipe).length===0,name).toBe(valid);
    if(valid){const group=buildModel(recipe as Model3dRecipe);expect(modelStatistics(group).triangles).toBeGreaterThan(3);expect(modelStatistics(group).size).toEqual(expect.arrayContaining([expect.any(Number)]));disposeGeometry(group);}
  });

  it.each(profileCases)('validates contour topology before building: $name', fixture => {
    const part = { ...model.parts[0], primitive: 'profile', profile: { outline: fixture.outline, holes: fixture.holes, bevel: 0 } };
    expect(validateModel3dRecipe({ ...model, parts: [part] }).length === 0).toBe(fixture.valid);
  });
  it('preserves physical bevel dimensions, small details, sRGB colors and PBR through GLB', async () => {
    const recipe: Model3dRecipe = { ...model, parts: [
      { ...model.parts[0], id: 'body', size: [8, 3, .2], bevel: .04, color: '#246bb3', roughness: .64, metalness: 0 },
      { ...model.parts[1], id: 'tiny', position: [0, 2, 0], size: [.001, .002, .003], segments: 16, smooth: false, color: '#c28d38', roughness: .22, metalness: .95 },
      { ...model.parts[0], id: 'glass', position: [0, 4, 0], material: 'Glass', opacity: .3, roughness: .1 },
      { ...model.parts[0], id: 'light', position: [0, 6, 0], material: 'Neon', emissiveIntensity: 2.5 },
    ] };
    expect(validateModel3dRecipe(recipe)).toEqual([]);
    expect(model3dRequiresMesh(recipe)).toBe(true);
    const group = buildModel(recipe);
    expect((group.children[0] as THREE.Mesh).geometry.type).toBe('RoundedBoxGeometry');
    for (const [index, item] of group.children.entries()) {
      const mesh = item as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const actual = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray();
      actual.forEach((n, axis) => expect(n).toBeCloseTo(recipe.parts[index].size[axis], 5));
      expect(mesh.material.color.getHexString()).toBe(recipe.parts[index].color.slice(1));
    }
    expect((group.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.flatShading).toBe(true);
    const bytes = await exportGeometry(group, 'glb');
    const reopened = await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, '');
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
    reopened.scene.traverse(item => { if (item instanceof THREE.Mesh) meshes.push(item); });
    for (const part of recipe.parts) {
      const material = meshes.find(mesh => mesh.userData.partId === part.id)!.material;
      const expected = model3dSurface(part);
      expect(material.color.getHexString()).toBe(part.color.slice(1));
      expect(material.roughness).toBeCloseTo(expected.roughness);
      expect(material.metalness).toBeCloseTo(expected.metalness);
      expect(material.opacity).toBeCloseTo(expected.opacity);
      const emission = material.emissive.clone().multiplyScalar(material.emissiveIntensity);
      const expectedEmission = new THREE.Color(part.color).multiplyScalar(expected.emissiveIntensity);
      emission.toArray().forEach((n, i) => expect(n).toBeCloseTo(expectedEmission.toArray()[i]));
    }
    disposeGeometry(group); disposeGeometry(reopened.scene);
  });
  it('accepts 128 parts and rejects invalid surface, resolution, radius and extra fields', () => {
    const detailed = { ...model, parts: Array.from({ length: 128 }, (_, i) => ({ ...model.parts[0], id: `p${i}` })) };
    expect(validateModel3dRecipe(detailed)).toEqual([]);
    expect(model3dRequiresMesh(detailed)).toBe(false);
    expect(validateModel3dRecipe({ ...detailed, parts: [...detailed.parts, { ...model.parts[0], id: 'overflow' }] })).not.toEqual([]);
    for (const patch of [{ roughness: -1 }, { metalness: 2 }, { opacity: null }, { emissiveIntensity: 6 }, { bevel: .3 }, { segments: 24 }, { smooth: 'yes' }, { texture: 'fake.png' }, { size: [.0009, 2, 2] }]) {
      expect(validateModel3dRecipe({ ...model, parts: [{ ...model.parts[0], ...patch }] }), JSON.stringify(patch)).not.toEqual([]);
    }
    for (const segments of [7, 64.5, 65]) expect(validateModel3dRecipe({ ...model, parts: [{ ...model.parts[1], segments }] })).not.toEqual([]);
  });
  it('stops excessive tessellation before preview or export', () => {
    const excessive: Model3dRecipe = { ...model, parts: Array.from({ length: 64 }, (_, i) => ({ ...model.parts[1], id: `s${i}`, segments: 64 })) };
    expect(() => buildModel(excessive)).toThrow(/200.000/);
  });
  it('builds six real primitives with matching bounds, finite normals and readable OBJ/GLB', async () => {
    expect(validateModel3dRecipe(model)).toEqual([]);
    const group = buildModel(model);
    expect(group.children).toHaveLength(6);
    for (const item of group.children) {
      const mesh = item as THREE.Mesh;
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).toArray();
      expect(size[0]).toBeCloseTo(2); expect(size[1]).toBeCloseTo(3); expect(size[2]).toBeCloseTo(1);
      expect([...mesh.geometry.attributes.normal.array].every(Number.isFinite)).toBe(true);
    }
    expect(modelStatistics(group).triangles).toBeGreaterThan(100);
    const obj = await exportGeometry(group, 'obj');
    const reopenedObj = new OBJLoader().parse(new TextDecoder().decode(obj));
    expect(reopenedObj.children).toHaveLength(6);
    const bytes = await exportGeometry(group, 'glb');
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
    const reopened = await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, '');
    expect(reopened.scene.children[0].children).toHaveLength(6);
    expect(modelStatistics(reopened.scene).size).toEqual(modelStatistics(group).size);
    disposeGeometry(group); disposeGeometry(reopened.scene); disposeGeometry(reopenedObj);
  });
  it.each(['R6', 'R15'] as const)('evaluates interpolated %s joint poses and exports playable tracks', async (rigType) => {
    const joint = rigType === 'R6' ? 'Right Arm' : 'RightUpperArm';
    const recipe: AnimationRecipe = {
      name: `Attack ${rigType}`, rigType, duration: 2, loop: true, priority: 'Action',
      keyframes: [{ time: 0, jointRotations: { [joint]: [0, 0, 0] } }, { time: 1, jointRotations: { [joint]: [90, 0, 0] } }, { time: 2, jointRotations: { [joint]: [0, 0, 0] } }],
    };
    expect(validateAnimationRecipe(recipe)).toEqual([]);
    const rig = buildReferenceRig(rigType);
    expect([...rig.joints.keys()].sort()).toEqual([...rigJoints[rigType]].sort());
    evaluateMotion(rig, recipe, .5);
    const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 4, 0, 0));
    expect(rig.joints.get(joint)!.quaternion.angleTo(expected)).toBeCloseTo(0);
    evaluateMotion(rig, recipe, 0); const first = rig.joints.get(joint)!.quaternion.clone();
    evaluateMotion(rig, recipe, 2); expect(rig.joints.get(joint)!.quaternion.equals(first)).toBe(true);
    evaluateMotion(rig, recipe, 0);
    const bytes = await exportGeometry(rig.group, 'glb', [motionClip(rig, recipe)]);
    const reopened = await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, '');
    expect(reopened.animations).toHaveLength(1); expect(reopened.animations[0].duration).toBe(2);
    const mixer = new THREE.AnimationMixer(reopened.scene); mixer.clipAction(reopened.animations[0]).play(); mixer.update(.5);
    const loadedJoint = reopened.scene.getObjectByName(joint.replace(/ /g, '_')) ?? reopened.scene.getObjectByName(joint.replace(/ /g, ''));
    expect(reopened.animations[0].tracks.length).toBe(rigJoints[rigType].length);
    expect(loadedJoint ?? reopened.scene.getObjectByName(joint)).toBeDefined();
    mixer.stopAllAction(); disposeGeometry(rig.group); disposeGeometry(reopened.scene);
  });
  it('rejects hostile geometry and loop discontinuities before renderer sees them', () => {
    expect(validateModel3dRecipe(null).length).toBeGreaterThan(0);
    expect(validateModel3dRecipe({ ...model, parts: [model.parts[0], model.parts[0]] }).length).toBeGreaterThan(0);
    expect(validateModel3dRecipe({ ...model, parts: [{ ...model.parts[0], size: [1, NaN, 1] }] }).length).toBeGreaterThan(0);
    expect(validateAnimationRecipe({ name: 'Bad', rigType: 'R15', duration: 1, loop: true, priority: 'Idle', keyframes: [
      { time: 0, jointRotations: { Head: [0, 0, 0] } }, { time: 1, jointRotations: { Head: [10, 0, 0] } },
    ] }).some((issue) => issue.path === 'loop')).toBe(true);
  });
});
