import { describe, expect, it } from 'vitest';
import type { SfxRecipe } from '@forgekit/contracts';
import {
  encodeWav,
  renderWaveformSvg,
  sfxPresets,
  synthesizeSfx,
  SAMPLE_RATE,
} from './dsp';

const testRecipe: SfxRecipe = {
  name: 'Tembakan Laser',
  ...sfxPresets.laser,
  seed: 42,
};

describe('SFX DSP Engine', () => {
  it('rejects invalid input before allocating sample buffers', () => {
    for (const durationMs of [NaN, Infinity, -1, 1e12]) {
      expect(() => synthesizeSfx({ ...testRecipe, durationMs })).toThrow();
    }
    expect(() => encodeWav(new Float32Array([NaN]), SAMPLE_RATE)).toThrow();
  });

  it('keeps short overlapping envelopes finite with quiet loop boundaries', () => {
    const result = synthesizeSfx({ ...testRecipe, durationMs: 50, attackMs: 1000, decayMs: 2000, releaseMs: 2000, loop: true });
    expect(result.samples.every(Number.isFinite)).toBe(true);
    expect(result.samples[0]).toBe(0);
    expect(Math.abs(result.samples.at(-1)!)).toBe(0);
    expect(result.analysis.peakLinear).toBeGreaterThan(0);
    expect(result.analysis.hasClipping).toBe(false);
    const view = new DataView(result.wavBytes.buffer);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint32(40, true)).toBe(result.samples.length * 2);
  });
  it('synthesizes valid audio buffer and analysis metrics', () => {
    const result = synthesizeSfx(testRecipe);
    expect(result.issues).toEqual([]);
    expect(result.samples.length).toBeGreaterThan(0);
    // durationMs = 200 ms -> ~8820 samples
    const expectedSamples = Math.floor((200 / 1000) * SAMPLE_RATE);
    expect(result.samples.length).toBe(expectedSamples);
    expect(result.analysis.peakLinear).toBeGreaterThan(0);
    expect(result.analysis.peakLinear).toBeLessThanOrEqual(1.0);
    expect(result.analysis.hasClipping).toBe(false);
  });

  it('produces valid WAV format with correct RIFF header', () => {
    const result = synthesizeSfx(testRecipe);
    const wav = result.wavBytes;

    // RIFF header
    const headerStr = String.fromCharCode(...wav.slice(0, 4));
    expect(headerStr).toBe('RIFF');

    // WAVE format
    const waveStr = String.fromCharCode(...wav.slice(8, 12));
    expect(waveStr).toBe('WAVE');

    // fmt subchunk
    const fmtStr = String.fromCharCode(...wav.slice(12, 16));
    expect(fmtStr).toBe('fmt ');

    // data subchunk
    const dataStr = String.fromCharCode(...wav.slice(36, 40));
    expect(dataStr).toBe('data');

    // Total size check (44 bytes header + samples * 2)
    const expectedSize = 44 + result.samples.length * 2;
    expect(wav.length).toBe(expectedSize);
  });

  it('changes audio output deterministically with different seeds', () => {
    const sound1 = synthesizeSfx({ ...testRecipe, seed: 101, waveform: 'noise', noiseMix: 0.8 });
    const sound2 = synthesizeSfx({ ...testRecipe, seed: 202, waveform: 'noise', noiseMix: 0.8 });
    const sound1Repeat = synthesizeSfx({ ...testRecipe, seed: 101, waveform: 'noise', noiseMix: 0.8 });

    // Same seed -> exact same samples
    expect(sound1.samples[100]).toBe(sound1Repeat.samples[100]);
    // Different seed -> different samples
    expect(sound1.samples[100]).not.toBe(sound2.samples[100]);
  });

  it('renders a valid SVG waveform visualization', () => {
    const result = synthesizeSfx(testRecipe);
    const svg = renderWaveformSvg(result.waveformPeaks, 480, 120);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 480 120"');
    expect(svg).toContain('<path');
  });

  it('verifies all 8 presets generate non-empty audio without errors', () => {
    const categories = Object.keys(sfxPresets) as (keyof typeof sfxPresets)[];
    expect(categories.length).toBe(8);

    for (const cat of categories) {
      const recipe: SfxRecipe = {
        name: `Preset ${cat}`,
        ...sfxPresets[cat],
        seed: 777,
      };
      const result = synthesizeSfx(recipe);
      expect(result.issues).toEqual([]);
      expect(result.samples.length).toBeGreaterThan(0);
      expect(result.analysis.peakLinear).toBeGreaterThan(0);
      expect(result.analysis.hasClipping).toBe(false);
    }
  });
});
