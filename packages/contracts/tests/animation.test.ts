import { describe, expect, it } from 'vitest';
import {
  analyzeAnimation, clipTime, evaluateClip, eulerXYZToQuat, migrateAnimationRecipe, quatAngle, sampleTrack,
  validateAnimationDocument, type AnimationDocument, type ObjectAnimationDocument, type CharacterAnimationDocument,
} from '../src/index';

const yaw = (degrees: number) => eulerXYZToQuat([0, degrees, 0]);
const base = {
  schemaVersion: 2, targetEngine: 'roblox', units: 'stud', coordinateSystem: 'y-up-right-handed',
  rotationConvention: 'quaternion-xyzw-local', timeUnit: 'seconds', qualityProfile: 'high_polish',
} as const;

function door(): ObjectAnimationDocument {
  return {
    ...base, name: 'Pintu berat', animationMode: 'object',
    object: { parts: [
      { id: 'frame', name: 'Kusen', parentId: null, shape: 'block', size: [0.5, 8, 0.5], color: '#553311', pivot: [0, 4, 0], offset: [0, 0, 0], restRotation: [0, 0, 0, 1] },
      { id: 'panel', name: 'Daun pintu', parentId: 'frame', shape: 'block', size: [4, 7, 0.3], color: '#885522', pivot: [0.25, -0.5, 0], offset: [2, 0, 0], restRotation: [0, 0, 0, 1] },
      { id: 'handle', name: 'Gagang', parentId: 'panel', shape: 'cylinder', size: [0.2, 0.6, 0.2], color: '#cccccc', pivot: [3.5, 0, 0.3], offset: [0, 0, 0], restRotation: [0, 0, 0, 1] },
    ] },
    motionIntent: {
      originalPrompt: 'Buka pintu 100 derajat dalam 1.2 detik, gagang diputar dulu, kusen tetap diam.',
      requirements: [
        { id: 'handle-first', kind: 'sequence', text: 'Gagang berputar sebelum daun pintu', excerpt: 'gagang diputar dulu', binding: { clipId: 'open', targetIds: ['handle'], window: [0, 0.3] } },
        { id: 'open-100', kind: 'action', text: 'Daun pintu membuka 100°', excerpt: 'Buka pintu 100 derajat', binding: { clipId: 'open', targetIds: ['panel'], window: [0.3, 1.2] } },
        { id: 'frame-still', kind: 'prohibition', text: 'Kusen tidak bergerak', excerpt: 'kusen tetap diam', binding: { clipId: 'open', targetIds: ['frame'], window: [0, 1.2] } },
      ],
      assumptions: ['Arah buka ke dalam (+Y).'],
    },
    clips: [{
      id: 'open', name: 'Buka', durationSeconds: 1.2, loopMode: 'once',
      tracks: [
        { targetId: 'handle', property: 'rotation', interpolation: 'smooth', keys: [{ timeSeconds: 0, value: [0, 0, 0, 1] }, { timeSeconds: 0.3, value: eulerXYZToQuat([0, 0, -45]) }] },
        { targetId: 'panel', property: 'rotation', interpolation: 'smooth', keys: [{ timeSeconds: 0.3, value: yaw(0) }, { timeSeconds: 0.75, value: yaw(55) }, { timeSeconds: 1.2, value: yaw(100) }] },
      ],
      markers: [{ id: 'opened', timeSeconds: 1.2, eventType: 'door_open' }],
    }],
  };
}

describe('AnimationDocument v2 validation', () => {
  it('accepts a well-formed object document and enforces the requested mode', () => {
    expect(validateAnimationDocument(door())).toEqual([]);
    expect(validateAnimationDocument(door(), 'character')[0].message).toContain('berbeda dari mode');
  });

  it('rejects unknown targets, non-unit quaternions, unordered keys and ambiguous half turns', () => {
    const bad = door();
    bad.clips[0].tracks.push({ targetId: 'ghost', property: 'rotation', interpolation: 'linear', keys: [{ timeSeconds: 0, value: [0, 0, 0, 1] }] });
    bad.clips[0].tracks[0].keys[1].value = [0, 0, 0, 2];
    bad.clips[0].tracks[1].keys = [{ timeSeconds: 0.5, value: yaw(0) }, { timeSeconds: 0.4, value: yaw(10) }];
    const messages = validateAnimationDocument(bad).map((i) => i.message).join(' | ');
    expect(messages).toContain('"ghost" tidak ada');
    expect(messages).toContain('quaternion satuan');
    expect(messages).toContain('naik ketat');
    const turn = door();
    turn.clips[0].tracks[1].keys = [{ timeSeconds: 0, value: yaw(0) }, { timeSeconds: 1, value: yaw(180) }];
    expect(validateAnimationDocument(turn).map((i) => i.message).join()).toContain('Putaran ≥180°');
  });

  it('keeps in-place characters from moving the root and requires prohibitions to name targets', () => {
    const doc = migrateAnimationRecipe({ name: 'Idle', rigType: 'R15', duration: 2, loop: true, priority: 'Idle', keyframes: [
      { time: 0, jointRotations: { UpperTorso: [0, 0, 0] } }, { time: 1, jointRotations: { UpperTorso: [4, 0, 0] } }, { time: 2, jointRotations: { UpperTorso: [0, 0, 0] } },
    ] });
    expect(validateAnimationDocument(doc)).toEqual([]);
    doc.clips[0].tracks.push({ targetId: 'Root', property: 'position', interpolation: 'linear', keys: [{ timeSeconds: 0, value: [0, 0, 0] }] });
    expect(validateAnimationDocument(doc).map((i) => i.message).join()).toContain('Root');
    const noTargets = door();
    noTargets.motionIntent.requirements[2].binding = null;
    expect(validateAnimationDocument(noTargets).map((i) => i.message).join()).toContain('Larangan harus menyebut target');
  });
});

describe('time-based evaluation', () => {
  it('returns identical poses at the same time regardless of frame rate', () => {
    const clip = door().clips[0];
    for (let frame = 0; frame <= 36; frame++) {
      const at30 = evaluateClip(clip, frame / 30); const at60 = evaluateClip(clip, (frame * 2) / 60);
      expect(at60.get('panel')!.rotation).toEqual(at30.get('panel')!.rotation);
    }
  });

  it('wraps loops, reflects ping-pong and clamps once', () => {
    expect(clipTime({ durationSeconds: 2, loopMode: 'loop' }, 5)).toBeCloseTo(1);
    expect(clipTime({ durationSeconds: 2, loopMode: 'pingpong' }, 3)).toBeCloseTo(1);
    expect(clipTime({ durationSeconds: 2, loopMode: 'once' }, 9)).toBe(2);
  });

  it('interpolates along the shortest path and reaches each key exactly', () => {
    const track = { targetId: 'panel', property: 'rotation' as const, interpolation: 'linear' as const, keys: [
      { timeSeconds: 0, value: yaw(170) }, { timeSeconds: 1, value: yaw(-170) },
    ] };
    expect(quatAngle(sampleTrack(track, 0.5), yaw(180))).toBeLessThan(0.01);
    const smooth = door().clips[0].tracks[1];
    expect(quatAngle(sampleTrack(smooth, 0.75), yaw(55))).toBeLessThan(1e-4);
    expect(quatAngle(sampleTrack(smooth, 1.2), yaw(100))).toBeLessThan(1e-4);
  });

  it('migrates v1 Euler recipes without changing their poses', () => {
    const doc = migrateAnimationRecipe({ name: 'Wave', rigType: 'R6', duration: 1, loop: false, priority: 'Action', keyframes: [
      { time: 0, jointRotations: { 'Right Arm': [0, 0, 0] } }, { time: 1, jointRotations: { 'Right Arm': [0, 0, 120] } },
    ] });
    expect(doc.character.rigType).toBe('R6');
    expect(quatAngle(evaluateClip(doc.clips[0], 1).get('Right Arm')!.rotation, eulerXYZToQuat([0, 0, 120]))).toBeLessThan(1e-4);
  });
});

describe('quality report', () => {
  it('verifies prohibitions numerically and leaves action meaning to visual review', () => {
    const report = analyzeAnimation(door());
    const byId = Object.fromEntries(report.requirements.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ 'handle-first': 'partial', 'open-100': 'partial', 'frame-still': 'satisfied' });
    expect(report.status).toBe('technically_verified');
    expect(report.notChecked.join()).toContain('Tinjauan artistik');
  });

  it('fails when a part the prompt locked moves, or a required action has no motion', () => {
    const doc = door();
    doc.clips[0].tracks.push({ targetId: 'frame', property: 'position', interpolation: 'linear', keys: [{ timeSeconds: 0, value: [0, 0, 0] }, { timeSeconds: 1, value: [0, 0.5, 0] }] });
    doc.motionIntent.requirements[1].binding!.targetIds = ['handle'];
    doc.motionIntent.requirements[1].binding!.window = [0.5, 1.2];
    const report = analyzeAnimation(doc);
    expect(report.status).toBe('needs_revision');
    expect(report.requirements.find((r) => r.id === 'frame-still')!.status).toBe('unsatisfied');
    expect(report.requirements.find((r) => r.id === 'open-100')!.status).toBe('unsatisfied');
  });

  it('catches loop seams that match in pose but not in speed, and seams that do not match at all', () => {
    const loop: CharacterAnimationDocument = migrateAnimationRecipe({ name: 'Sway', rigType: 'R15', duration: 2, loop: true, priority: 'Idle', keyframes: [
      { time: 0, jointRotations: { UpperTorso: [0, 0, 0] } }, { time: 1.9, jointRotations: { UpperTorso: [0, 30, 0] } }, { time: 2, jointRotations: { UpperTorso: [0, 0, 0] } },
    ] });
    expect(analyzeAnimation(loop).checks.find((c) => c.id === 'loop-seam')!.status).toBe('warn');
    const broken: AnimationDocument = structuredClone(loop);
    broken.clips[0].tracks[0].keys[2].value = yaw(20);
    expect(analyzeAnimation(broken).checks.find((c) => c.id === 'loop-seam')!.status).toBe('fail');
  });
});

describe('review fixes', () => {
  it('treats a part held in a non-rest pose as still, and flags parts carried by a moving parent', () => {
    const doc = door();
    // Handle is locked raised for the whole clip, while its parent panel swings open.
    doc.clips[0].tracks[0] = { targetId: 'handle', property: 'rotation', interpolation: 'linear', keys: [{ timeSeconds: 0, value: eulerXYZToQuat([0, 0, -45]) }, { timeSeconds: 1.2, value: eulerXYZToQuat([0, 0, -45]) }] };
    doc.motionIntent.requirements[0] = { id: 'handle-still', kind: 'prohibition', text: 'Gagang tidak berputar', excerpt: 'gagang tetap', binding: { clipId: 'open', targetIds: ['handle'], window: [0, 1.2] } };
    expect(validateAnimationDocument(doc)).toEqual([]);
    const result = analyzeAnimation(doc).requirements.find((r) => r.id === 'handle-still')!;
    expect(result.status).toBe('partial');
    expect(result.evidence).toContain('panel');
    expect(analyzeAnimation(doc).requirements.find((r) => r.id === 'frame-still')!.status).toBe('satisfied');
  });

  it('rejects in the UI validator what the backend rejects on save', () => {
    const looped = door();
    looped.clips[0].loopMode = 'loop';
    expect(validateAnimationDocument(looped).map((i) => i.message).join()).toContain('pose awal dan akhir');
    const moving = door();
    moving.clips[0].tracks.push({ targetId: 'frame', property: 'position', interpolation: 'linear', keys: [{ timeSeconds: 0, value: [0, 0, 0] }, { timeSeconds: 1, value: [0, 0.5, 0] }] });
    expect(validateAnimationDocument(moving).map((i) => i.message).join()).toContain('melarang frame');
  });

  it('samples many keys correctly with the binary search', () => {
    const keys = Array.from({ length: 200 }, (_, i) => ({ timeSeconds: i / 10, value: [i, 0, 0] }));
    const track = { targetId: 'panel', property: 'position' as const, interpolation: 'linear' as const, keys };
    for (const t of [0, 0.05, 7.33, 19.9, 25]) expect(sampleTrack(track, t)[0]).toBeCloseTo(Math.min(t, 19.9) * 10, 9);
  });
});
