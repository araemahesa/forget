import * as THREE from 'three';
import source from './roblox-rigs.json';
import meshData from './roblox-rig-meshes.json';

export type ReferenceRig = { group: THREE.Group; joints: Map<string, THREE.Group> };
function cframe(values: number[]) {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = values;
  return new THREE.Matrix4().set(a,b,c,x, d,e,f,y, g,h,i,z, 0,0,0,1);
}

/** Native Roblox body meshes and Motor6D bind frames, captured from Studio's default rigs. */
export function buildReferenceRig(type: 'R6' | 'R15'): ReferenceRig {
  const data = source.rigs[type];
  const group = new THREE.Group(); group.name = `Roblox ${type}`;
  group.userData.source = data.source;
  const parts = new Map<string, THREE.Group>(), joints = new Map<string, THREE.Group>();
  for (const part of data.parts) {
    const node = new THREE.Group(); node.name = `${part.name} body`; parts.set(part.name, node);
    if (part.name === 'HumanoidRootPart') continue;
    const assetId = part.mesh.match(/id=(\d+)/)?.[1] ?? (part.name === 'Head' ? 'head' : '');
    const asset = (meshData as Record<string, { positions: number[]; normals: number[]; uv: number[]; indices: number[] }>)[assetId];
    const geometry = asset ? new THREE.BufferGeometry() : new THREE.BoxGeometry(...part.size as [number,number,number]);
    if (asset) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(asset.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(asset.uv, 2)); geometry.setIndex(asset.indices);
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: `#${part.color}`, roughness: .72 }));
    mesh.name = part.name; mesh.userData.partId = part.name; mesh.userData.source = assetId || 'Roblox Part';
    if (asset && 'meshSize' in part && part.meshSize) mesh.scale.fromArray(part.size.map((n, i) => n / part.meshSize![i]));
    else if (asset && 'meshScale' in part && part.meshScale) mesh.scale.fromArray(part.meshScale);
    if ('meshOffset' in part && part.meshOffset) mesh.position.fromArray(part.meshOffset);
    node.add(mesh);
  }
  group.add(parts.get('HumanoidRootPart')!);
  for (const motor of data.motors) {
    const bind = new THREE.Group(); bind.name = `${motor.name} bind`; bind.applyMatrix4(cframe(motor.c0));
    const motion = new THREE.Group(); motion.name = motor.part1; motion.userData.motor6D = motor.name;
    const child = parts.get(motor.part1)!; child.applyMatrix4(cframe(motor.c1).invert());
    parts.get(motor.part0)!.add(bind); bind.add(motion); motion.add(child); joints.set(motor.part1, motion);
  }
  group.updateMatrixWorld(true);
  group.position.y = -new THREE.Box3().setFromObject(group).min.y;
  group.updateMatrixWorld(true);
  return { group, joints };
}
