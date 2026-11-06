// AnimationDocument v2: prompt-driven character and object animation.
// Rotations are unit quaternions [x, y, z, w] in the target's local space, applied on top of the
// rest pose; positions are offsets in studs from the rest position. Evaluation is a pure function
// of time in seconds, so playback speed never depends on frame rate.
import type { ValidationIssue } from './gfx';
import type { AnimationRecipe } from './motionAudio';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type AnimationMode = 'character' | 'object';
export type LoopMode = 'once' | 'loop' | 'pingpong';
export type Interpolation = 'linear' | 'smooth' | 'step';
export type AnimationQualityProfile = 'draft' | 'production' | 'high_polish';
export type RequirementKind = 'action' | 'sequence' | 'timing' | 'direction' | 'style' | 'contact' | 'prohibition' | 'other';

export type MotionRequirement = {
  id: string;
  kind: RequirementKind;
  text: string;
  /** Verbatim fragment of the user's prompt this requirement comes from. */
  excerpt: string;
  /** Where the requirement is realized; prohibitions list the targets that must stay still. */
  binding: { clipId: string; targetIds: string[]; window: [number, number] } | null;
};
export type MotionIntent = { originalPrompt: string; requirements: MotionRequirement[]; assumptions: string[] };

export type AnimationKey = { timeSeconds: number; value: number[] };
export type AnimationTrack = { targetId: string; property: 'rotation' | 'position'; interpolation: Interpolation; keys: AnimationKey[] };
export type AnimationMarker = { id: string; timeSeconds: number; eventType: string };
export type AnimationClipV2 = { id: string; name: string; durationSeconds: number; loopMode: LoopMode; tracks: AnimationTrack[]; markers: AnimationMarker[] };

export type CharacterTarget = { rigType: 'R6' | 'R15'; rigSource: 'reference'; rootPolicy: 'in_place' | 'root_motion'; priority: 'Core' | 'Idle' | 'Movement' | 'Action' };
export type ObjectShape = 'block' | 'cylinder' | 'sphere' | 'wedge';
export type ObjectPart = {
  id: string; name: string; parentId: string | null; shape: ObjectShape; size: Vec3; color: string;
  /** Rest position of this part's pivot in its parent's pivot space (world for roots). */
  pivot: Vec3;
  /** Geometry center relative to the pivot, e.g. half the door width away from the hinge. */
  offset: Vec3;
  restRotation: Quat;
};
export type ObjectTarget = { parts: ObjectPart[] };

type DocumentBase = {
  schemaVersion: 2; name: string; targetEngine: 'roblox'; units: 'stud';
  coordinateSystem: 'y-up-right-handed'; rotationConvention: 'quaternion-xyzw-local'; timeUnit: 'seconds';
  qualityProfile: AnimationQualityProfile; motionIntent: MotionIntent; clips: AnimationClipV2[];
};
export type CharacterAnimationDocument = DocumentBase & { animationMode: 'character'; character: CharacterTarget };
export type ObjectAnimationDocument = DocumentBase & { animationMode: 'object'; object: ObjectTarget };
export type AnimationDocument = CharacterAnimationDocument | ObjectAnimationDocument;

export const R15_JOINTS = ['LowerTorso', 'UpperTorso', 'Head', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand', 'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot'] as const;
export const R6_JOINTS = ['Torso', 'Head', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg'] as const;
/** Character root (HumanoidRootPart); only a position track under root_motion. */
export const ROOT_TARGET = 'Root';
const ROOT_TARGET_NAME = ROOT_TARGET;
export const ANIMATION_LIMITS = { clips: 4, duration: 120, tracksPerClip: 64, keysPerTrack: 240, totalKeys: 4000, parts: 32, requirements: 40, markers: 32, position: 2048, size: 512 } as const;

const R15_PARENTS: Record<string, string | null> = {
  LowerTorso: ROOT_TARGET_NAME, UpperTorso: 'LowerTorso', Head: 'UpperTorso',
  LeftUpperArm: 'UpperTorso', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm',
  RightUpperArm: 'UpperTorso', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm',
  LeftUpperLeg: 'LowerTorso', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg',
  RightUpperLeg: 'LowerTorso', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg',
};
const R6_PARENTS: Record<string, string | null> = { Torso: ROOT_TARGET_NAME, Head: 'Torso', 'Left Arm': 'Torso', 'Right Arm': 'Torso', 'Left Leg': 'Torso', 'Right Leg': 'Torso' };
/** Every ancestor of a target (nearest first): motion there moves the target in the world. */
export function targetAncestors(doc: AnimationDocument, targetId: string): string[] {
  const parentOf = doc.animationMode === 'character'
    ? (id: string) => (doc.character.rigType === 'R15' ? R15_PARENTS : R6_PARENTS)[id] ?? null
    : (id: string) => doc.object.parts.find((p) => p.id === id)?.parentId ?? null;
  const chain: string[] = []; let cursor = parentOf(targetId);
  while (cursor && !chain.includes(cursor)) { chain.push(cursor); cursor = parentOf(cursor); }
  return chain;
}

export function characterTargets(rig: 'R6' | 'R15'): readonly string[] {
  return rig === 'R6' ? R6_JOINTS : R15_JOINTS;
}
export function isAnimationDocument(value: unknown): value is AnimationDocument {
  return !!value && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === 2;
}

// ---------- quaternion math ----------
export const IDENTITY: Quat = [0, 0, 0, 1];
export function quatDot(a: readonly number[], b: readonly number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }
export function quatNormalize(q: readonly number[]): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}
export function quatMultiply(a: readonly number[], b: readonly number[]): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** Angle in degrees between two orientations (sign-insensitive). */
export function quatAngle(a: readonly number[], b: readonly number[]) {
  return (2 * Math.acos(Math.min(1, Math.abs(quatDot(quatNormalize(a), quatNormalize(b)))))) * 180 / Math.PI;
}
export function quatSlerp(a: readonly number[], b: readonly number[], t: number): Quat {
  let other = [...b];
  let cos = quatDot(a, b);
  if (cos < 0) { other = other.map((v) => -v); cos = -cos; }
  if (cos > 0.9995) return quatNormalize(a.map((v, i) => v + (other[i] - v) * t));
  const theta = Math.acos(cos); const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin; const wb = Math.sin(t * theta) / sin;
  return quatNormalize(a.map((v, i) => v * wa + other[i] * wb));
}
/** Euler XYZ degrees (the v1 recipe convention, matching THREE.Euler default order) to quaternion. */
export function eulerXYZToQuat([x, y, z]: readonly number[]): Quat {
  const [cx, cy, cz] = [x, y, z].map((v) => Math.cos(v * Math.PI / 360));
  const [sx, sy, sz] = [x, y, z].map((v) => Math.sin(v * Math.PI / 360));
  return quatNormalize([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

// ---------- evaluation ----------
/** Maps playback time to clip-local time according to the loop mode. */
export function clipTime(clip: Pick<AnimationClipV2, 'durationSeconds' | 'loopMode'>, time: number) {
  const d = clip.durationSeconds;
  if (!(time > 0)) return 0;
  if (clip.loopMode === 'loop') return time % d === 0 && time > 0 ? d : time % d;
  if (clip.loopMode === 'pingpong') { const cycle = time % (2 * d); return cycle <= d ? cycle : 2 * d - cycle; }
  return Math.min(time, d);
}
function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t; const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** Value of a track at clip-local time t. Before the first / after the last key the end value holds. */
export function sampleTrack(track: AnimationTrack, t: number): number[] {
  const keys = track.keys;
  if (t <= keys[0].timeSeconds) return [...keys[0].value];
  const last = keys[keys.length - 1];
  if (t >= last.timeSeconds) return [...last.value];
  // Binary search for the first key at or after t (keys are strictly increasing).
  let lo = 1; let hi = keys.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid].timeSeconds < t) lo = mid + 1; else hi = mid; }
  const i = lo;
  const a = keys[i - 1]; const b = keys[i];
  const f = (t - a.timeSeconds) / (b.timeSeconds - a.timeSeconds);
  if (track.interpolation === 'step') return [...a.value];
  if (track.property === 'rotation') {
    if (track.interpolation === 'linear') return quatSlerp(a.value, b.value, f);
    // Smooth: Catmull-Rom on sign-aligned quaternion components, then normalize (C1 at keys).
    const align = (q: readonly number[]) => (quatDot(q, a.value) < 0 ? q.map((v) => -v) : [...q]);
    const p0 = align(keys[Math.max(0, i - 2)].value); const p1 = [...a.value];
    const p2 = align(b.value); const p3 = align(keys[Math.min(keys.length - 1, i + 1)].value);
    return quatNormalize(p1.map((_, c) => catmull(p0[c], p1[c], p2[c], p3[c], f)));
  }
  if (track.interpolation === 'linear') return a.value.map((v, c) => v + (b.value[c] - v) * f);
  const p0 = keys[Math.max(0, i - 2)].value; const p3 = keys[Math.min(keys.length - 1, i + 1)].value;
  return a.value.map((v, c) => catmull(p0[c], v, b.value[c], p3[c], f));
}
export type Pose = Map<string, { rotation: Quat; position: Vec3 }>;
/** Pose of every animated target at playback time (seconds), relative to rest. */
export function evaluateClip(clip: AnimationClipV2, time: number): Pose {
  const t = clipTime(clip, time);
  const pose: Pose = new Map();
  for (const track of clip.tracks) {
    const entry = pose.get(track.targetId) ?? { rotation: [...IDENTITY] as Quat, position: [0, 0, 0] as Vec3 };
    const value = sampleTrack(track, t);
    if (track.property === 'rotation') entry.rotation = quatNormalize(value);
    else entry.position = [value[0], value[1], value[2]];
    pose.set(track.targetId, entry);
  }
  return pose;
}

// ---------- validation ----------
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, n: number, bound = Infinity) => Array.isArray(v) && v.length === n && v.every((x) => finite(x) && Math.abs(x) <= bound);
const text = (v: unknown, max: number, min = 1) => typeof v === 'string' && v.trim().length >= min && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const isUnit = (q: unknown) => vec(q, 4) && Math.abs(Math.hypot(...(q as number[])) - 1) <= 1e-3;

export function validateAnimationDocument(input: unknown, requestedMode?: AnimationMode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string) => { issues.push({ path, severity: 'error', message }); };
  // Untrusted input: read fields loosely, narrow only after checking them.
  const doc = input as Partial<DocumentBase> & { animationMode?: string; character?: CharacterTarget; object?: ObjectTarget };
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 2) { fail('schemaVersion', 'Dokumen animasi harus schemaVersion 2.'); return issues; }
  if (doc.animationMode !== 'character' && doc.animationMode !== 'object') { fail('animationMode', 'Mode harus character atau object.'); return issues; }
  if (requestedMode && doc.animationMode !== requestedMode) fail('animationMode', `Mode dokumen (${doc.animationMode}) berbeda dari mode yang diminta (${requestedMode}).`);
  if (!text(doc.name, 120)) fail('name', 'Nama animasi wajib (maks. 120 karakter).');
  if (doc.targetEngine !== 'roblox' || doc.units !== 'stud' || doc.coordinateSystem !== 'y-up-right-handed' || doc.rotationConvention !== 'quaternion-xyzw-local' || doc.timeUnit !== 'seconds') fail('conventions', 'Konvensi harus roblox · stud · y-up-right-handed · quaternion-xyzw-local · seconds.');
  if (!['draft', 'production', 'high_polish'].includes(doc.qualityProfile as string)) fail('qualityProfile', 'Profil kualitas tidak dikenal.');

  // Valid targets per mode.
  const targets = new Set<string>();
  if (doc.animationMode === 'character') {
    const c = doc.character as CharacterTarget | undefined;
    if (!c || !['R6', 'R15'].includes(c.rigType) || c.rigSource !== 'reference' || !['in_place', 'root_motion'].includes(c.rootPolicy) || !['Core', 'Idle', 'Movement', 'Action'].includes(c.priority)) fail('character', 'Target karakter tidak sah (rigType, rigSource, rootPolicy, priority).');
    else { characterTargets(c.rigType).forEach((j) => targets.add(j)); if (c.rootPolicy === 'root_motion') targets.add(ROOT_TARGET); }
  } else {
    const parts = (doc.object as ObjectTarget | undefined)?.parts;
    if (!Array.isArray(parts) || !parts.length || parts.length > ANIMATION_LIMITS.parts) fail('object.parts', `Objek perlu 1–${ANIMATION_LIMITS.parts} bagian.`);
    else {
      parts.forEach((p, i) => {
        const at = `object.parts[${i}]`;
        if (!ID.test(p?.id ?? '') || targets.has(p.id)) fail(at, 'ID bagian kosong, tidak sah, atau duplikat.');
        targets.add(p?.id);
        if (!text(p?.name, 80) || !['block', 'cylinder', 'sphere', 'wedge'].includes(p?.shape) || !COLOR.test(p?.color ?? '')) fail(at, 'Nama, bentuk, atau warna bagian tidak sah.');
        if (!vec(p?.size, 3, ANIMATION_LIMITS.size) || p.size.some((s) => s <= 0)) fail(`${at}.size`, 'Ukuran harus positif dan wajar.');
        if (!vec(p?.pivot, 3, ANIMATION_LIMITS.position) || !vec(p?.offset, 3, ANIMATION_LIMITS.position)) fail(at, 'Pivot atau offset tidak sah.');
        if (!isUnit(p?.restRotation)) fail(`${at}.restRotation`, 'restRotation harus quaternion satuan.');
      });
      const byId = new Map(parts.map((p) => [p.id, p]));
      parts.forEach((p, i) => {
        if (p.parentId !== null && !byId.has(p.parentId)) fail(`object.parts[${i}].parentId`, 'Parent tidak ditemukan.');
        // Reject cycles: walking parents must reach a root.
        let cursor: ObjectPart | undefined = p; let steps = 0;
        while (cursor && cursor.parentId !== null && steps <= parts.length) { cursor = byId.get(cursor.parentId); steps++; }
        if (steps > parts.length) fail(`object.parts[${i}].parentId`, 'Hierarki bagian membentuk siklus.');
      });
    }
  }

  // Clips, tracks, keys, markers.
  const clipIds = new Map<string, AnimationClipV2>();
  let totalKeys = 0;
  if (!Array.isArray(doc.clips) || !doc.clips.length || doc.clips.length > ANIMATION_LIMITS.clips) fail('clips', `Perlu 1–${ANIMATION_LIMITS.clips} clip.`);
  else doc.clips.forEach((clip, ci) => {
    const at = `clips[${ci}]`;
    if (!ID.test(clip?.id ?? '') || clipIds.has(clip.id)) fail(at, 'ID clip tidak sah atau duplikat.');
    clipIds.set(clip?.id, clip);
    if (!text(clip?.name, 120) || !finite(clip?.durationSeconds) || clip.durationSeconds <= 0 || clip.durationSeconds > ANIMATION_LIMITS.duration || !['once', 'loop', 'pingpong'].includes(clip?.loopMode)) { fail(at, 'Nama, durasi (0–120 s), atau loopMode clip tidak sah.'); return; }
    if (!Array.isArray(clip.tracks) || !clip.tracks.length || clip.tracks.length > ANIMATION_LIMITS.tracksPerClip) { fail(`${at}.tracks`, `Clip perlu 1–${ANIMATION_LIMITS.tracksPerClip} track.`); return; }
    const seen = new Set<string>();
    clip.tracks.forEach((track, ti) => {
      const tat = `${at}.tracks[${ti}]`;
      const key = `${track?.targetId}:${track?.property}`;
      if (!targets.has(track?.targetId)) fail(tat, `Target "${track?.targetId}" tidak ada pada rig/objek.`);
      if (seen.has(key)) fail(tat, 'Satu target hanya boleh punya satu track per properti.');
      seen.add(key);
      if (!['rotation', 'position'].includes(track?.property) || !['linear', 'smooth', 'step'].includes(track?.interpolation)) { fail(tat, 'Properti atau interpolasi tidak sah.'); return; }
      if (doc.animationMode === 'character' && track.property === 'position' && track.targetId !== ROOT_TARGET) fail(tat, 'Karakter hanya boleh punya track posisi pada Root (root motion).');
      if (track.targetId === ROOT_TARGET && track.property !== 'position') fail(tat, 'Root hanya menerima track posisi.');
      if (!Array.isArray(track.keys) || !track.keys.length || track.keys.length > ANIMATION_LIMITS.keysPerTrack) { fail(tat, `Track perlu 1–${ANIMATION_LIMITS.keysPerTrack} key.`); return; }
      totalKeys += track.keys.length;
      let previous = -1;
      track.keys.forEach((k, ki) => {
        const kat = `${tat}.keys[${ki}]`;
        if (!finite(k?.timeSeconds) || k.timeSeconds < 0 || k.timeSeconds > clip.durationSeconds + 1e-9 || k.timeSeconds <= previous) fail(kat, 'Waktu key harus naik ketat di dalam durasi clip.');
        previous = finite(k?.timeSeconds) ? k.timeSeconds : previous;
        if (track.property === 'rotation') {
          if (!isUnit(k?.value)) fail(kat, 'Rotasi harus quaternion satuan [x,y,z,w].');
          // A segment of 180° or more is ambiguous for shortest-path interpolation.
          else if (ki > 0 && isUnit(track.keys[ki - 1].value) && quatAngle(track.keys[ki - 1].value, k.value) >= 179.5) fail(kat, 'Putaran ≥180° antar dua key ambigu; tambahkan key perantara untuk putaran penuh.');
        } else if (!vec(k?.value, 3, ANIMATION_LIMITS.position)) fail(kat, 'Posisi harus [x,y,z] dalam stud.');
      });
    });
    if (doc.animationMode === 'character' && (doc.character as CharacterTarget | undefined)?.rootPolicy === 'in_place' && clip.tracks.some((t) => t.targetId === ROOT_TARGET)) fail(at, 'Mode in_place tidak boleh menggerakkan Root.');
    // Same hard rule as the backend: a loop ends where it starts (held values make first/last keys the seam).
    if (clip.loopMode === 'loop') clip.tracks.forEach((track, ti) => {
      const keys = Array.isArray(track?.keys) ? track.keys : [];
      if (keys.length < 2 || !Array.isArray(keys[0]?.value) || !Array.isArray(keys[keys.length - 1]?.value)) return;
      const a = keys[0].value; const b = keys[keys.length - 1].value;
      const gap = track.property === 'rotation' ? quatAngle(a, b) : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (gap > (track.property === 'rotation' ? 1 : 0.01)) fail(`${at}.tracks[${ti}]`, `Loop: pose awal dan akhir ${track.targetId} berbeda; samakan agar loop tidak meloncat.`);
    });
    const markers = clip.markers ?? [];
    if (!Array.isArray(markers) || markers.length > ANIMATION_LIMITS.markers) fail(`${at}.markers`, 'Terlalu banyak marker.');
    else {
      const markerIds = new Set<string>();
      markers.forEach((m, mi) => {
        if (!ID.test(m?.id ?? '') || markerIds.has(m.id) || !finite(m?.timeSeconds) || m.timeSeconds < 0 || m.timeSeconds > clip.durationSeconds || !/^[a-z][a-z0-9_]{0,39}$/.test(m?.eventType ?? '')) fail(`${at}.markers[${mi}]`, 'Marker perlu id unik, waktu dalam durasi, dan eventType snake_case.');
        markerIds.add(m?.id);
      });
    }
  });
  if (totalKeys > ANIMATION_LIMITS.totalKeys) fail('clips', `Total key melampaui ${ANIMATION_LIMITS.totalKeys}.`);

  // Motion intent and requirement bindings.
  const intent = doc.motionIntent as MotionIntent | undefined;
  if (!intent || !text(intent.originalPrompt, 4000) || !Array.isArray(intent.assumptions) || intent.assumptions.length > 20 || !intent.assumptions.every((a) => text(a, 300))) fail('motionIntent', 'motionIntent perlu originalPrompt dan daftar asumsi.');
  else if (!Array.isArray(intent.requirements) || !intent.requirements.length || intent.requirements.length > ANIMATION_LIMITS.requirements) fail('motionIntent.requirements', `Perlu 1–${ANIMATION_LIMITS.requirements} kebutuhan dari prompt.`);
  else {
    const reqIds = new Set<string>();
    intent.requirements.forEach((r, ri) => {
      const at = `motionIntent.requirements[${ri}]`;
      if (!ID.test(r?.id ?? '') || reqIds.has(r.id)) fail(at, 'ID kebutuhan tidak sah atau duplikat.');
      reqIds.add(r?.id);
      if (!['action', 'sequence', 'timing', 'direction', 'style', 'contact', 'prohibition', 'other'].includes(r?.kind) || !text(r?.text, 300) || !text(r?.excerpt, 400)) fail(at, 'Jenis, teks, atau kutipan prompt kebutuhan tidak sah.');
      if (r?.binding === null || r?.binding === undefined) {
        if (r?.kind === 'prohibition') fail(at, 'Larangan harus menyebut target yang wajib diam.');
        return;
      }
      const clip = clipIds.get(r.binding.clipId);
      if (!clip) { fail(`${at}.binding`, 'Clip binding tidak ditemukan.'); return; }
      if (!Array.isArray(r.binding.targetIds) || !r.binding.targetIds.length || r.binding.targetIds.some((t) => !targets.has(t))) fail(`${at}.binding`, 'Target binding tidak ada pada rig/objek.');
      const w = r.binding.window;
      if (!vec(w, 2) || w[0] < 0 || w[1] > clip.durationSeconds + 1e-9 || w[0] >= w[1]) { fail(`${at}.binding.window`, 'Jendela waktu harus [mulai, selesai] di dalam durasi clip.'); return; }
      // Same hard rule as the backend: a prohibited part keeps its value inside the window.
      if (r.kind === 'prohibition') for (const track of clip.tracks ?? []) {
        if (!r.binding.targetIds.includes(track?.targetId) || !Array.isArray(track.keys) || !track.keys.length) continue;
        const held = [...track.keys].reverse().find((k) => k.timeSeconds <= w[0] + 1e-9) ?? track.keys[0];
        const moved = track.keys.some((k) => k.timeSeconds > w[0] + 1e-9 && k.timeSeconds <= w[1] + 1e-9
          && (track.property === 'rotation' ? quatAngle(k.value, held.value) > 0.5 : Math.hypot(k.value[0] - held.value[0], k.value[1] - held.value[1], k.value[2] - held.value[2]) > 0.005));
        if (moved) fail(`${at}.binding`, `Kebutuhan "${r.id}" melarang ${track.targetId} bergerak, tetapi track-nya berubah di dalam jendela.`);
      }
    });
  }
  return issues;
}

/** Reads a v1 Euler recipe as a v2 character document (keys stay at the same times). */
export function migrateAnimationRecipe(recipe: AnimationRecipe, originalPrompt = recipe.name): CharacterAnimationDocument {
  const joints = characterTargets(recipe.rigType);
  const tracks: AnimationTrack[] = joints
    .filter((joint) => recipe.keyframes.some((frame) => frame.jointRotations[joint]))
    .map((joint) => ({
      targetId: joint, property: 'rotation', interpolation: 'linear',
      keys: recipe.keyframes.map((frame) => ({ timeSeconds: frame.time, value: eulerXYZToQuat(frame.jointRotations[joint] ?? [0, 0, 0]) })),
    }));
  return {
    schemaVersion: 2, name: recipe.name, targetEngine: 'roblox', units: 'stud', coordinateSystem: 'y-up-right-handed',
    rotationConvention: 'quaternion-xyzw-local', timeUnit: 'seconds', qualityProfile: 'draft', animationMode: 'character',
    character: { rigType: recipe.rigType, rigSource: 'reference', rootPolicy: 'in_place', priority: recipe.priority },
    motionIntent: {
      originalPrompt,
      requirements: [{ id: 'legacy', kind: 'other', text: 'Animasi v1 dimigrasikan tanpa daftar kebutuhan asli.', excerpt: originalPrompt.slice(0, 400) || recipe.name, binding: null }],
      assumptions: ['Dimigrasikan dari recipe v1 (Euler XYZ derajat → quaternion); kebutuhan prompt asli tidak tercatat di v1.'],
    },
    clips: [{ id: 'main', name: recipe.name, durationSeconds: recipe.duration, loopMode: recipe.loop ? 'loop' : 'once', tracks, markers: [] }],
  };
}
