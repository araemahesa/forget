import { validateMusicRecipe, type MusicRecipe } from '@forgekit/contracts';
import { analyzeSamples } from '../sfx/dsp';

export const MUSIC_SAMPLE_RATE = 22050;

export function pitchFrequency(pitch: string): number {
  const match = /^([A-G])(#|b)?([0-8])$/.exec(pitch);
  if (!match) throw new Error('Pitch musik tidak sah.');
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1] as 'C'];
  const midi = (Number(match[3]) + 1) * 12 + semitone + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

export function synthesizeMusic(recipe: MusicRecipe) {
  const issues = validateMusicRecipe(recipe);
  if (issues.length) throw new Error(issues[0].message);
  if (!recipe.tracks.some((track) => track.volume > 0 && track.notes.length)) throw new Error('Partitur belum memiliki nada yang dapat didengar. Generate atau isi nada sebelum sintesis.');
  const samples = new Float32Array(Math.floor(recipe.durationSeconds * MUSIC_SAMPLE_RATE));
  // ponytail: oscillator lokal tanpa soundfont; tambah sampler saat aset instrumen berlisensi tersedia.
  for (const track of recipe.tracks) for (const note of track.notes) {
    const start = Math.floor(note.time * MUSIC_SAMPLE_RATE);
    const length = Math.min(Math.floor(note.duration * MUSIC_SAMPLE_RATE), samples.length - start);
    const frequency = pitchFrequency(note.pitch);
    let noise = 1;
    for (let i = 0; i < length; i++) {
      const t = i / MUSIC_SAMPLE_RATE, phase = 2 * Math.PI * frequency * t;
      const attack = track.instrument === 'pad' ? .04 : .005;
      const envelope = Math.min(1, t / attack, (length - 1 - i) / (MUSIC_SAMPLE_RATE * .025));
      let value = Math.sin(phase);
      if (track.instrument === 'percussion') {
        noise = Math.imul(noise, 1664525) + 1013904223 | 0;
        value = ((noise >>> 0) / 2147483648 - 1) * Math.exp(-t * 35);
      } else if (track.instrument !== 'bass' && frequency * 2 < MUSIC_SAMPLE_RATE / 2) {
        value = .8 * value + .2 * Math.sin(phase * 2);
      }
      samples[start + i] += value * envelope * track.volume * .25;
    }
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i]) * .9;
  return analyzeSamples(samples, MUSIC_SAMPLE_RATE);
}
