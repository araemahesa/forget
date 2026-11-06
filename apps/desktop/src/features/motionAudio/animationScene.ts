import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ROOT_TARGET, evaluateClip, type AnimationClipV2, type AnimationDocument, type ObjectTarget, type Pose, type QualityCheck,
} from '@forgekit/contracts';
import { buildReferenceRig, disposeGeometry, exportGeometry } from '../create/geometry';

/** A previewable scene: the target object plus the nodes each track drives. */
export type AnimationScene = {
  group: THREE.Group;
  /** Animated node per targetId, with its rest transform (pose is always applied on top of rest). */
  nodes: Map<string, { node: THREE.Object3D; restQuaternion: THREE.Quaternion; restPosition: THREE.Vector3 }>;
  height: number;
  dispose: () => void;
};

function register(nodes: AnimationScene['nodes'], id: string, node: THREE.Object3D) {
  nodes.set(id, { node, restQuaternion: node.quaternion.clone(), restPosition: node.position.clone() });
}

function characterScene(rigType: 'R6' | 'R15'): AnimationScene {
  const rig = buildReferenceRig(rigType);
  const nodes: AnimationScene['nodes'] = new Map();
  // Unique, binder-safe node names: meshes reuse the part names, and '.', ':' are reserved in track paths.
  for (const [name, node] of rig.joints) { node.name = `joint_${name.replace(/[^A-Za-z0-9_]/g, '_')}`; register(nodes, name, node); }
  rig.group.name = 'Root';
  register(nodes, ROOT_TARGET, rig.group);
  const height = new THREE.Box3().setFromObject(rig.group).getSize(new THREE.Vector3()).y;
  return { group: rig.group, nodes, height, dispose: () => disposeGeometry(rig.group) };
}

function geometryFor(shape: string, size: number[]) {
  const [x, y, z] = size;
  if (shape === 'cylinder') { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.scale(x, y, z); return g; }
  if (shape === 'sphere') { const g = new THREE.SphereGeometry(0.5, 24, 16); g.scale(x, y, z); return g; }
  if (shape === 'wedge') {
    const s = new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, 0.5)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); g.scale(x, y, z); return g;
  }
  return new THREE.BoxGeometry(x, y, z);
}

function objectScene(target: ObjectTarget): AnimationScene {
  const group = new THREE.Group(); group.name = 'Objek';
  const nodes: AnimationScene['nodes'] = new Map();
  const pivots = new Map<string, THREE.Group>();
  target.parts.forEach((part, index) => {
    const pivot = new THREE.Group(); pivot.name = `pivot_${index}_${part.id.replace(/[^A-Za-z0-9_]/g, '_')}`;
    pivot.position.fromArray(part.pivot); pivot.quaternion.fromArray(part.restRotation);
    const mesh = new THREE.Mesh(geometryFor(part.shape, part.size), new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.65 }));
    mesh.name = part.name; mesh.position.fromArray(part.offset);
    pivot.add(mesh); pivots.set(part.id, pivot);
  });
  for (const part of target.parts) (part.parentId ? pivots.get(part.parentId)! : group).add(pivots.get(part.id)!);
  for (const part of target.parts) register(nodes, part.id, pivots.get(part.id)!);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  group.position.y = -box.min.y; // stand on the grid
  group.updateMatrixWorld(true);
  return { group, nodes, height: box.getSize(new THREE.Vector3()).y, dispose: () => disposeGeometry(group) };
}

export function buildAnimationScene(doc: AnimationDocument): AnimationScene {
  return doc.animationMode === 'character' ? characterScene(doc.character.rigType) : objectScene(doc.object);
}

/** Sets every animated node to rest × pose. Unanimated nodes return to rest, so nothing drifts. */
export function applyPose(scene: AnimationScene, pose: Pose) {
  for (const [id, entry] of scene.nodes) {
    const value = pose.get(id);
    entry.node.quaternion.copy(entry.restQuaternion);
    entry.node.position.copy(entry.restPosition);
    if (!value) continue;
    entry.node.quaternion.multiply(new THREE.Quaternion(...value.rotation));
    entry.node.position.add(new THREE.Vector3(...value.position));
  }
}

/**
 * Foot sliding on the reference rig: while a foot is planted (near its lowest height and barely
 * moving vertically), its horizontal drift must stay within 1% of the rig height.
 */
export function footSlideCheck(doc: AnimationDocument, scene: AnimationScene, clip: AnimationClipV2): QualityCheck {
  const feet = doc.animationMode === 'character' ? (doc.character.rigType === 'R15' ? ['LeftFoot', 'RightFoot'] : ['Left Leg', 'Right Leg']) : [];
  if (!feet.length) return { id: 'foot-slide', label: 'Kaki selip', status: 'not_checked', detail: 'Hanya untuk karakter.' };
  const animatedLegs = clip.tracks.some((t) => /Leg|Foot|Root|LowerTorso|Torso/.test(t.targetId));
  if (!animatedLegs) return { id: 'foot-slide', label: 'Kaki selip', status: 'pass', detail: 'Kaki dan pinggul tidak dianimasikan; kontak tetap pada pose diam.' };
  const hz = 60; const tolerance = 0.01 * scene.height; const plantBand = 0.04 * scene.height;
  const worst: string[] = [];
  for (const foot of feet) {
    const node = scene.nodes.get(foot)?.node; if (!node) continue;
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i <= Math.ceil(clip.durationSeconds * hz); i++) {
      applyPose(scene, evaluateClip(clip, Math.min(clip.durationSeconds, i / hz)));
      scene.group.updateMatrixWorld(true);
      samples.push(node.getWorldPosition(new THREE.Vector3()));
    }
    const minY = Math.min(...samples.map((p) => p.y));
    let anchor: THREE.Vector3 | null = null; let maxSlide = 0;
    for (let i = 0; i < samples.length; i++) {
      const planted = samples[i].y <= minY + plantBand && (i === 0 || Math.abs(samples[i].y - samples[i - 1].y) * hz < 0.5);
      if (!planted) { anchor = null; continue; }
      anchor ??= samples[i];
      maxSlide = Math.max(maxSlide, Math.hypot(samples[i].x - anchor.x, samples[i].z - anchor.z));
    }
    if (maxSlide > tolerance) worst.push(`${foot} ${maxSlide.toFixed(3)} stud`);
  }
  applyPose(scene, new Map());
  return worst.length
    ? { id: 'foot-slide', label: 'Kaki selip', status: 'warn', detail: `Kaki yang menapak bergeser melebihi 1% tinggi rig (${tolerance.toFixed(3)} stud): ${worst.join('; ')}. Wajar untuk gerak meluncur yang diminta.` }
    : { id: 'foot-slide', label: 'Kaki selip', status: 'pass', detail: `Kaki yang menapak bergeser ≤1% tinggi rig (${tolerance.toFixed(3)} stud) pada rig referensi.` };
}

const BAKE_HZ = 30;
/** glTF has no Catmull-Rom; smooth curves are baked to linear samples at 30 Hz. */
function bakedClip(scene: AnimationScene, clip: AnimationClipV2) {
  const times = Array.from({ length: Math.ceil(clip.durationSeconds * BAKE_HZ) + 1 }, (_, i) => Math.min(clip.durationSeconds, i / BAKE_HZ));
  const tracks: THREE.KeyframeTrack[] = [];
  const animated = new Set(clip.tracks.map((t) => `${t.targetId}:${t.property}`));
  for (const [id, entry] of scene.nodes) {
    const rotation = animated.has(`${id}:rotation`); const position = animated.has(`${id}:position`);
    if (!rotation && !position) continue;
    const q: number[] = []; const p: number[] = [];
    for (const t of times) {
      const value = evaluateClip(clip, t).get(id);
      if (rotation) q.push(...entry.restQuaternion.clone().multiply(new THREE.Quaternion(...(value?.rotation ?? [0, 0, 0, 1]))).toArray());
      if (position) p.push(...entry.restPosition.clone().add(new THREE.Vector3(...(value?.position ?? [0, 0, 0]))).toArray());
    }
    if (rotation) tracks.push(new THREE.QuaternionKeyframeTrack(`${entry.node.name}.quaternion`, times, q));
    if (position) tracks.push(new THREE.VectorKeyframeTrack(`${entry.node.name}.position`, times, p));
  }
  return new THREE.AnimationClip(clip.name, clip.durationSeconds, tracks);
}

export type ExportResult = { bytes: Uint8Array; verification: string[]; verified: boolean };
/** Exports every clip to GLB, reloads the file and compares durations, tracks and sampled values. */
export async function exportAnimationGlb(doc: AnimationDocument): Promise<ExportResult> {
  const scene = buildAnimationScene(doc);
  try {
    applyPose(scene, new Map());
    const clips = doc.clips.map((clip) => bakedClip(scene, clip));
    const bytes = await exportGeometry(scene.group, 'glb', clips);
    const copy = bytes.slice().buffer;
    const reloaded = await new GLTFLoader().parseAsync(copy, '');
    const problems: string[] = [];
    if (reloaded.animations.length !== clips.length) problems.push(`jumlah clip ${reloaded.animations.length} ≠ ${clips.length}`);
    for (const clip of clips) {
      const back = reloaded.animations.find((a) => a.name === clip.name);
      if (!back) { problems.push(`clip "${clip.name}" hilang`); continue; }
      if (Math.abs(back.duration - clip.duration) > 1e-3) problems.push(`durasi "${clip.name}" berubah`);
      for (const track of clip.tracks) {
        const other = back.tracks.find((t) => t.name === track.name);
        if (!other) { problems.push(`track ${track.name} hilang`); continue; }
        if (other.times.length !== track.times.length) { problems.push(`jumlah sampel ${track.name} berubah`); continue; }
        let error = 0;
        for (let i = 0; i < track.values.length; i++) error = Math.max(error, Math.abs(track.values[i] - other.values[i]));
        if (error > 1e-4) problems.push(`nilai ${track.name} berubah ${error.toExponential(1)}`);
      }
    }
    const trackCount = clips.reduce((sum, c) => sum + c.tracks.length, 0);
    const verification = problems.length ? problems : [`${clips.length} clip, ${trackCount} track dibaca ulang dari GLB tanpa perubahan (kurva di-bake ${BAKE_HZ} Hz).`];
    return { bytes, verification, verified: !problems.length };
  } finally { scene.dispose(); }
}
