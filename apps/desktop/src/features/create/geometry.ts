import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MODEL3D_MAX_TRIANGLES, model3dSurface, rigJoints, validateAnimationRecipe, validateModel3dRecipe, type AnimationRecipe, type Model3dRecipe } from '@forgekit/contracts';

function wedge() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5,-.5,-.5, .5,-.5,-.5, .5,-.5,.5, -.5,-.5,-.5, .5,-.5,.5, -.5,-.5,.5,
    -.5,-.5,-.5, -.5,.5,-.5, .5,.5,-.5, -.5,-.5,-.5, .5,.5,-.5, .5,-.5,-.5,
    -.5,.5,-.5, -.5,-.5,.5, .5,-.5,.5, -.5,.5,-.5, .5,-.5,.5, .5,.5,-.5,
    -.5,-.5,-.5, -.5,-.5,.5, -.5,.5,-.5, .5,-.5,-.5, .5,.5,-.5, .5,-.5,.5,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildModel(recipe: Model3dRecipe) {
  const issues = validateModel3dRecipe(recipe); if (issues.length) throw new Error(issues[0].message);
  if (recipe.parts.some(part => part.primitive === 'reconstruction')) throw new Error('Rekonstruksi referensi harus dibangun di Blender. Pratinjau primitive tidak dapat menggantikannya.');
  const group = new THREE.Group(); group.name = recipe.name;
  let triangles = 0;
  for (const part of recipe.parts) {
    const segments = part.segments ?? (part.primitive === 'torus' ? 48 : 32);
    const bevel = part.bevel ?? 0;
    const geometry = part.primitive === 'mesh' ? meshGeometry(part.mesh!)
      : part.primitive === 'lathe' ? new THREE.LatheGeometry(part.lathe!.points.map(p => new THREE.Vector2(...p)), segments)
      : part.primitive === 'cube' && bevel > 0 ? new RoundedBoxGeometry(...part.size, 3, bevel)
      : part.primitive === 'profile' ? profileGeometry(part.profile!) : part.primitive === 'sphere' ? new THREE.SphereGeometry(.5, segments, Math.max(4, Math.floor(segments / 2)))
      : part.primitive === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, segments)
        : part.primitive === 'cone' ? new THREE.ConeGeometry(.5, 1, segments)
          : part.primitive === 'torus' ? new THREE.TorusGeometry(.38, .12, Math.max(4, Math.floor(segments / 4)), segments)
            : part.primitive === 'wedge' ? wedge() : new THREE.BoxGeometry(1, 1, 1);
    geometry.computeBoundingBox();
    geometry.center();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    geometry.scale(part.size[0] / size.x, part.size[1] / size.y, part.size[2] / size.z);
    const surface = model3dSurface(part);
    const smooth = part.smooth ?? (['sphere', 'cylinder', 'cone', 'torus', 'mesh', 'lathe'].includes(part.primitive) || bevel > 0);
    const material = new THREE.MeshStandardMaterial({
      color: part.color, ...surface, flatShading: !smooth,
      transparent: surface.opacity < 1,
      emissive: surface.emissiveIntensity > 0 ? part.color : '#000000',
    });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; mesh.userData.partId = part.id;
    mesh.position.fromArray(part.position);
    mesh.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
    group.add(mesh);
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    if (triangles > MODEL3D_MAX_TRIANGLES) { disposeGeometry(group); throw new Error('Geometri melampaui 200.000 triangle. Kurangi resolusi radial atau detail tersembunyi.'); }
  }
  group.updateMatrixWorld(true);
  return group;
}

function meshGeometry(mesh: NonNullable<Model3dRecipe['parts'][number]['mesh']>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
  geometry.setIndex(mesh.faces.flatMap(face => face.length === 3 ? face : [face[0],face[1],face[2],face[0],face[2],face[3]]));
  geometry.computeVertexNormals();
  return geometry;
}

function profileGeometry(profile: NonNullable<Model3dRecipe['parts'][number]['profile']>) {
  const shape = new THREE.Shape(profile.outline.map(p => new THREE.Vector2(...p)));
  shape.holes = profile.holes.map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(...p))));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: profile.bevel > 0, bevelSize: profile.bevel, bevelThickness: profile.bevel, bevelSegments: 3 });
  geometry.center();
  return geometry;
}

export function disposeGeometry(group: THREE.Object3D) {
  group.traverse((item) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Line || item instanceof THREE.Points) {
      item.geometry.dispose();
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    }
  });
}

export function modelStatistics(group: THREE.Object3D) {
  let triangles = 0; let vertices = 0;
  group.traverse((item) => {
    if (item instanceof THREE.Mesh) {
      vertices += item.geometry.attributes.position.count;
      triangles += (item.geometry.index?.count ?? item.geometry.attributes.position.count) / 3;
    }
  });
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).toArray();
  return { triangles, vertices, size };
}

export { buildReferenceRig } from './robloxRig';
import type { ReferenceRig } from './robloxRig';
export type { ReferenceRig } from './robloxRig';

function rotation(frame: AnimationRecipe['keyframes'][number], joint: string) {
  const angles = frame.jointRotations[joint] ?? [0, 0, 0];
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles.map(THREE.MathUtils.degToRad) as [number, number, number]));
}
export function evaluateMotion(rig: ReferenceRig, recipe: AnimationRecipe, time: number) {
  const t = THREE.MathUtils.clamp(time, 0, recipe.duration);
  let index = recipe.keyframes.findIndex((frame) => frame.time >= t);
  if (index < 0) index = recipe.keyframes.length - 1;
  const after = recipe.keyframes[index]; const before = recipe.keyframes[Math.max(0, index - 1)];
  const factor = after.time === before.time ? 0 : (t - before.time) / (after.time - before.time);
  for (const [name, node] of rig.joints) node.quaternion.copy(rotation(before, name)).slerp(rotation(after, name), factor);
}
export function motionClip(rig: ReferenceRig, recipe: AnimationRecipe) {
  const issues = validateAnimationRecipe(recipe); if (issues.length) throw new Error(issues[0].message);
  const times = recipe.keyframes.map((frame) => frame.time);
  const tracks = rigJoints[recipe.rigType].map((joint) => new THREE.QuaternionKeyframeTrack(
    `${rig.joints.get(joint)!.uuid}.quaternion`, times, recipe.keyframes.flatMap((frame) => rotation(frame, joint).toArray()),
  ));
  return new THREE.AnimationClip(recipe.name, recipe.duration, tracks);
}
export async function exportGeometry(group: THREE.Object3D, format: 'glb' | 'obj', animations: THREE.AnimationClip[] = []) {
  group.updateMatrixWorld(true);
  if (format === 'obj') return new TextEncoder().encode(new OBJExporter().parse(group));
  const result = await new GLTFExporter().parseAsync(group, { binary: true, animations });
  if (!(result instanceof ArrayBuffer)) throw new Error('Exporter tidak menghasilkan GLB.');
  return new Uint8Array(result);
}
