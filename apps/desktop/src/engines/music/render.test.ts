import { describe, expect, it } from 'vitest';
import { validateMusicRecipe, type MusicRecipe } from '@forgekit/contracts';
import { MUSIC_SAMPLE_RATE, pitchFrequency, synthesizeMusic } from './render';

const recipe: MusicRecipe = {
  title: 'A440 test', bpm: 120, timeSignature: '4/4', key: 'A', scale: 'minor', durationSeconds: 2,
  tracks: [{ id: 'bass', name: 'Bass', instrument: 'bass', volume: .6, notes: [{ pitch: 'A4', time: .5, duration: 1 }] }],
};
describe('music PCM synthesis', () => {
  it('produces reproducible PCM16 WAV with timing, audible 440 Hz and real waveform', () => {
    const audio = synthesizeMusic(recipe);
    const view = new DataView(audio.wavBytes.buffer as ArrayBuffer);
    expect(new TextDecoder().decode(audio.wavBytes.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(MUSIC_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(2 * MUSIC_SAMPLE_RATE * 2);
    expect(audio.wavBytes).toEqual(synthesizeMusic(recipe).wavBytes);
    expect(audio.analysis.hasClipping).toBe(false);
    expect(audio.analysis.rms).toBeGreaterThan(.01);
    expect(audio.waveformPeaks.some((peak) => peak.max > .05)).toBe(true);
    expect(audio.samples.slice(0, Math.floor(.5 * MUSIC_SAMPLE_RATE)).every((n) => n === 0)).toBe(true);
    expect(audio.samples.slice(Math.floor(1.5 * MUSIC_SAMPLE_RATE)).every((n) => n === 0)).toBe(true);
    let crossings = 0;
    for (let i = Math.floor(.6 * MUSIC_SAMPLE_RATE); i < Math.floor(1.4 * MUSIC_SAMPLE_RATE); i++) {
      if (audio.samples[i - 1] < 0 && audio.samples[i] >= 0) crossings++;
    }
    expect(Math.abs(crossings / .8 - 440)).toBeLessThan(2);
  });
  it('supports enharmonic pitches and rejects hostile/empty/overbudget scores', () => {
    expect(pitchFrequency('A4')).toBe(440);
    expect(pitchFrequency('C#4')).toBe(pitchFrequency('Db4'));
    expect(() => pitchFrequency('url(secret)')).toThrow();
    for (const notes of [
      [{ pitch: 'A9', time: 0, duration: 1 }],
      [{ pitch: 'A4', time: -1, duration: 1 }],
      [{ pitch: 'A4', time: 1, duration: 2 }],
      [{ pitch: 'A4', time: 0, duration: NaN }],
      Array.from({ length: 9 }, () => ({ pitch: 'A4', time: 0, duration: 2 })),
      Array.from({ length: 4097 }, () => ({ pitch: 'A4', time: 0, duration: .01 })),
    ]) expect(() => synthesizeMusic({ ...recipe, tracks: [{ ...recipe.tracks[0], notes }] })).toThrow();
    expect(() => synthesizeMusic({ ...recipe, tracks: [{ ...recipe.tracks[0], notes: [] }] })).toThrow(/belum/);
    expect(validateMusicRecipe(null)).not.toEqual([]);
    expect(validateMusicRecipe({ ...recipe, tracks: [...recipe.tracks, ...recipe.tracks] })).not.toEqual([]);
  });
  it('mixes all instruments without NaN/clipping and changes samples when notes change', () => {
    const tracks = (['lead', 'pad', 'synth', 'bass', 'percussion'] as const).map((instrument) => ({
      ...recipe.tracks[0], id: instrument, instrument,
    }));
    const audio = synthesizeMusic({ ...recipe, tracks });
    expect(audio.samples.every(Number.isFinite)).toBe(true);
    expect(audio.analysis.hasClipping).toBe(false);
    expect(audio.wavBytes).not.toEqual(synthesizeMusic(recipe).wavBytes);
  });
});
