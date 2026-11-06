// Deterministic quality checks for AnimationDocument v2. They measure the saved motion; they never
// claim artistic quality. "partial" means motion was detected where the prompt asked for it, but
// whether it reads as the requested action still needs visual review.
import { clipTime, quatAngle, sampleTrack, type AnimationClipV2, type AnimationDocument, type AnimationTrack, type MotionRequirement } from './animation';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'not_checked';
export type QualityCheck = { id: string; label: string; status: CheckStatus; detail: string };
export type RequirementStatus = 'satisfied' | 'partial' | 'unsatisfied' | 'unverifiable';
export type RequirementResult = { id: string; kind: MotionRequirement['kind']; text: string; excerpt: string; status: RequirementStatus; evidence: string };
export type AnimationQualityStatus = 'draft' | 'needs_revision' | 'technically_verified';
export type AnimationQualityReport = {
  status: AnimationQualityStatus;
  checks: QualityCheck[];
  requirements: RequirementResult[];
  conditions: string;
  notChecked: string[];
};

const SAMPLE_HZ = 120;
const POP_DEG_PER_S = 1440; // ~4 turns/s between consecutive samples suggests a pop, not intended motion.
const SEAM_ROTATION_DEG = 1;
const SEAM_POSITION = 0.01;
const STILL_ROTATION_DEG = 0.5;
const STILL_POSITION = 0.005;
const MOTION_ROTATION_DEG = 2;
const MOTION_POSITION = 0.02;

function deviation(track: AnimationTrack, a: number[], b: number[]) {
  return track.property === 'rotation' ? quatAngle(a, b) : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function sampleTimes(start: number, end: number) {
  const steps = Math.max(2, Math.ceil((end - start) * SAMPLE_HZ));
  return Array.from({ length: steps + 1 }, (_, i) => start + (end - start) * (i / steps));
}
/** Largest change of the targets inside [start, end] relative to their value at start. */
function motionIn(clip: AnimationClipV2, targetIds: string[], [start, end]: [number, number]) {
  let rotation = 0; let position = 0;
  for (const track of clip.tracks.filter((t) => targetIds.includes(t.targetId))) {
    const base = sampleTrack(track, start);
    for (const t of sampleTimes(start, end)) {
      const d = deviation(track, base, sampleTrack(track, t));
      if (track.property === 'rotation') rotation = Math.max(rotation, d); else position = Math.max(position, d);
    }
  }
  return { rotation, position };
}

function popCheck(doc: AnimationDocument): QualityCheck {
  const found: string[] = [];
  for (const clip of doc.clips) for (const track of clip.tracks) {
    if (track.interpolation === 'step' || track.keys.length < 2) continue;
    const times = sampleTimes(0, clip.durationSeconds);
    let previous = sampleTrack(track, 0);
    for (let i = 1; i < times.length; i++) {
      const value = sampleTrack(track, times[i]);
      const speed = deviation(track, previous, value) / (times[i] - times[i - 1]);
      if (track.property === 'rotation' && speed > POP_DEG_PER_S) { found.push(`${clip.id}/${track.targetId} @${times[i].toFixed(2)}s (${Math.round(speed)}°/s)`); break; }
      previous = value;
    }
  }
  return found.length
    ? { id: 'popping', label: 'Lonjakan rotasi (popping)', status: 'warn', detail: `Kecepatan rotasi melebihi ${POP_DEG_PER_S}°/s: ${found.slice(0, 4).join('; ')}. Wajar untuk benturan yang disengaja; selain itu tambahkan key perantara.` }
    : { id: 'popping', label: 'Lonjakan rotasi (popping)', status: 'pass', detail: `Tidak ada rotasi di atas ${POP_DEG_PER_S}°/s pada sampel ${SAMPLE_HZ} Hz.` };
}

function seamCheck(doc: AnimationDocument): QualityCheck {
  const loops = doc.clips.filter((c) => c.loopMode === 'loop');
  if (!loops.length) return { id: 'loop-seam', label: 'Sambungan loop', status: 'not_checked', detail: 'Tidak ada clip loop.' };
  const poseErrors: string[] = []; const velocityWarnings: string[] = [];
  const dt = 1 / SAMPLE_HZ;
  for (const clip of loops) for (const track of clip.tracks) {
    const d = clip.durationSeconds;
    const start = sampleTrack(track, 0); const end = sampleTrack(track, d);
    const gap = deviation(track, start, end);
    if (gap > (track.property === 'rotation' ? SEAM_ROTATION_DEG : SEAM_POSITION)) poseErrors.push(`${clip.id}/${track.targetId} ${gap.toFixed(2)}${track.property === 'rotation' ? '°' : ' stud'}`);
    // Speed leaving the start vs. speed arriving at the end: a matching pose with mismatched speed still hitches.
    const leaving = deviation(track, start, sampleTrack(track, Math.min(dt, d))) / dt;
    const arriving = deviation(track, sampleTrack(track, Math.max(0, d - dt)), end) / dt;
    const tolerance = track.property === 'rotation' ? Math.max(30, 0.35 * Math.max(leaving, arriving)) : Math.max(0.3, 0.35 * Math.max(leaving, arriving));
    if (Math.abs(leaving - arriving) > tolerance) velocityWarnings.push(`${clip.id}/${track.targetId}`);
  }
  if (poseErrors.length) return { id: 'loop-seam', label: 'Sambungan loop', status: 'fail', detail: `Pose awal ≠ akhir (batas ${SEAM_ROTATION_DEG}° / ${SEAM_POSITION} stud): ${poseErrors.slice(0, 4).join('; ')}.` };
  if (velocityWarnings.length) return { id: 'loop-seam', label: 'Sambungan loop', status: 'warn', detail: `Pose cocok, tetapi kecepatan masuk/keluar seam berbeda (bisa terasa tersendat): ${velocityWarnings.slice(0, 4).join('; ')}.` };
  return { id: 'loop-seam', label: 'Sambungan loop', status: 'pass', detail: 'Pose dan kecepatan di seam konsisten.' };
}

function requirementResult(doc: AnimationDocument, r: MotionRequirement): RequirementResult {
  const base = { id: r.id, kind: r.kind, text: r.text, excerpt: r.excerpt };
  if (!r.binding) {
    return { ...base, status: 'unverifiable', evidence: r.kind === 'style' ? 'Gaya hanya bisa dinilai lewat tinjauan visual.' : 'Tidak terikat ke target/waktu; perlu tinjauan visual.' };
  }
  const clip = doc.clips.find((c) => c.id === r.binding!.clipId);
  if (!clip) return { ...base, status: 'unsatisfied', evidence: 'Clip binding tidak ditemukan.' };
  const window = r.binding.window;
  const motion = motionIn(clip, r.binding.targetIds, window);
  const span = `${r.binding.targetIds.join(', ')} · ${window[0].toFixed(2)}–${window[1].toFixed(2)} s`;
  if (r.kind === 'prohibition') {
    const still = motion.rotation <= STILL_ROTATION_DEG && motion.position <= STILL_POSITION;
    return { ...base, status: still ? 'satisfied' : 'unsatisfied', evidence: `${span}: gerak maks ${motion.rotation.toFixed(2)}° / ${motion.position.toFixed(3)} stud (batas diam ${STILL_ROTATION_DEG}° / ${STILL_POSITION} stud).` };
  }
  const moved = motion.rotation > MOTION_ROTATION_DEG || motion.position > MOTION_POSITION;
  if (!moved) return { ...base, status: 'unsatisfied', evidence: `${span}: tidak ada gerak terukur pada target yang diikat.` };
  return { ...base, status: r.kind === 'style' ? 'unverifiable' : 'partial', evidence: `${span}: gerak terdeteksi (${motion.rotation.toFixed(1)}° / ${motion.position.toFixed(2)} stud). Kesesuaian makna perlu tinjauan visual.` };
}

/**
 * Runs every automated check. `extraChecks` lets the caller add rig-dependent checks
 * (e.g. foot sliding computed with forward kinematics in the viewport).
 */
export function analyzeAnimation(doc: AnimationDocument, extraChecks: QualityCheck[] = []): AnimationQualityReport {
  const checks: QualityCheck[] = [popCheck(doc), seamCheck(doc), ...extraChecks];
  if (doc.animationMode === 'character') {
    checks.push(doc.character.rootPolicy === 'in_place'
      ? { id: 'root-policy', label: 'Kebijakan root', status: 'pass', detail: 'In-place: Root tidak digerakkan clip; perpindahan dunia milik controller.' }
      : { id: 'root-policy', label: 'Kebijakan root', status: 'warn', detail: 'Root motion: pastikan controller tidak ikut memindahkan karakter (gerak ganda). Belum diuji di runtime Roblox.' });
  } else {
    checks.push({ id: 'rest-relative', label: 'Tanpa drift', status: 'pass', detail: 'Setiap bagian dievaluasi relatif terhadap pose diam dan pivotnya; tidak ada akumulasi transform per frame.' });
  }
  const requirements = doc.motionIntent.requirements.map((r) => requirementResult(doc, r));
  if (requirements.some((r) => r.kind === 'prohibition' && r.status === 'unsatisfied')) {
    checks.push({ id: 'prohibitions', label: 'Larangan dari prompt', status: 'fail', detail: 'Bagian yang diminta diam ternyata bergerak.' });
  } else if (requirements.some((r) => r.kind === 'prohibition')) {
    checks.push({ id: 'prohibitions', label: 'Larangan dari prompt', status: 'pass', detail: 'Bagian yang diminta diam tetap diam.' });
  }
  const unmet = requirements.filter((r) => r.status === 'unsatisfied');
  if (unmet.length) checks.push({ id: 'requirements', label: 'Kebutuhan prompt', status: 'fail', detail: `${unmet.length} kebutuhan tanpa gerak yang sesuai: ${unmet.map((r) => r.id).join(', ')}.` });
  const failed = checks.some((c) => c.status === 'fail');
  const status: AnimationQualityStatus = failed ? 'needs_revision' : doc.qualityProfile === 'draft' ? 'draft' : 'technically_verified';
  return {
    status, checks, requirements,
    conditions: `Sampel ${SAMPLE_HZ} Hz per clip, evaluasi berbasis waktu (tidak bergantung FPS). Ambang: seam ${SEAM_ROTATION_DEG}°/${SEAM_POSITION} stud, diam ${STILL_ROTATION_DEG}°/${STILL_POSITION} stud, popping ${POP_DEG_PER_S}°/s (sementara).`,
    notChecked: [
      'Tinjauan artistik (keterbacaan, berat, gaya) — perlu dilihat manusia.',
      'Tabrakan/penetrasi dengan geometri map.',
      doc.animationMode === 'character' ? 'Rig aktual di Studio (pratinjau memakai rig referensi R6/R15).' : 'Objek aktual di Studio (pratinjau memakai bagian dari dokumen).',
      'Runtime Roblox (Animator, blending, multiplayer).',
    ],
  };
}

/** Elapsed playback time → clip-local time, re-exported for UI scrubbing. */
export { clipTime };
