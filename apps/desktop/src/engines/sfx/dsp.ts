import type { SfxCategory, SfxRecipe, ValidationIssue } from '@forgekit/contracts';
import { validateSfxRecipe } from '@forgekit/contracts';

export const SAMPLE_RATE = 44100;

export type AudioAnalysis = {
  peakLinear: number;
  peakDbfs: number;
  rms: number;
  zeroCrossings: number;
  hasClipping: boolean;
};

export type WaveformPeak = {
  min: number;
  max: number;
};

export type SynthesizedAudio = {
  samples: Float32Array;
  wavBytes: Uint8Array;
  analysis: AudioAnalysis;
  waveformPeaks: WaveformPeak[];
  issues: ValidationIssue[];
};

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesizeSfx(recipe: SfxRecipe): SynthesizedAudio {
  const issues = validateSfxRecipe(recipe);
  if (issues.some((issue) => issue.severity === 'error')) {
    throw new Error(issues.map((issue) => issue.message).join(' '));
  }
  const totalSamples = Math.max(1, Math.floor((recipe.durationMs / 1000) * SAMPLE_RATE));
  const samples = new Float32Array(totalSamples);
  const prng = mulberry32(recipe.seed);

  // Envelope calculations in sample units
  // Compress overlapping ADSR stages so even a short take reaches its release.
  const envelopeScale = Math.min(1, recipe.durationMs / (recipe.attackMs + recipe.decayMs + recipe.releaseMs));
  const attackSamples = Math.floor((recipe.attackMs / 1000) * SAMPLE_RATE * envelopeScale);
  const decaySamples = Math.floor((recipe.decayMs / 1000) * SAMPLE_RATE * envelopeScale);
  const releaseSamples = Math.max(1, Math.floor((recipe.releaseMs / 1000) * SAMPLE_RATE * envelopeScale));

  // Lowpass filter coefficient
  const rc = 1.0 / (2 * Math.PI * recipe.filterCutoff);
  const dt = 1.0 / SAMPLE_RATE;
  const filterAlpha = dt / (rc + dt);
  let filterPrev = 0;

  let phase = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / totalSamples;

    // Pitch sweep
    const currentFreq = recipe.frequencyStart + (recipe.frequencyEnd - recipe.frequencyStart) * Math.pow(t, 1.25);
    phase += (currentFreq * 2 * Math.PI) / SAMPLE_RATE;

    // Base oscillator
    let osc = 0;
    switch (recipe.waveform) {
      case 'sine':
        osc = Math.sin(phase);
        break;
      case 'square':
        osc = Math.sin(phase) >= 0 ? 0.9 : -0.9;
        break;
      case 'sawtooth': {
        const norm = (phase / (2 * Math.PI)) % 1;
        osc = 2 * (norm < 0 ? norm + 1 : norm) - 1;
        break;
      }
      case 'triangle': {
        const norm = (phase / (2 * Math.PI)) % 1;
        const pos = norm < 0 ? norm + 1 : norm;
        osc = 2 * Math.abs(2 * pos - 1) - 1;
        break;
      }
      case 'noise':
        osc = prng() * 2 - 1;
        break;
    }

    // Blend noise if specified
    if (recipe.noiseMix > 0 && recipe.waveform !== 'noise') {
      const whiteNoise = prng() * 2 - 1;
      osc = osc * (1 - recipe.noiseMix) + whiteNoise * recipe.noiseMix;
    }

    // ADSR Envelope
    let env = 1;
    if (i < attackSamples) {
      env = attackSamples > 0 ? i / attackSamples : 1;
    } else if (i < attackSamples + decaySamples) {
      const decayProgress = (i - attackSamples) / decaySamples;
      env = 1 - (1 - recipe.sustain) * decayProgress;
    } else if (i >= totalSamples - releaseSamples) {
      const releaseProgress = (i - (totalSamples - releaseSamples)) / releaseSamples;
      env = recipe.sustain * (1 - releaseProgress);
    } else {
      env = recipe.sustain;
    }

    // Apply envelope and volume
    let sample = osc * env * recipe.volume;

    // Apply 1-pole Lowpass Filter
    filterPrev = filterPrev + filterAlpha * (sample - filterPrev);
    sample = filterPrev;

    // Soft saturation/limiter (tanh prevents harsh wrap clipping)
    sample = Math.tanh(sample);

    const edgeSamples = Math.min(220, Math.floor(totalSamples / 4));
    const edgeGain = Math.min(1, i / edgeSamples, (totalSamples - 1 - i) / edgeSamples);
    samples[i] = sample * (0.5 - 0.5 * Math.cos(Math.PI * edgeGain));
  }

  return { ...analyzeSamples(samples), issues };
}

export function analyzeSamples(samples: Float32Array, sampleRate = SAMPLE_RATE): SynthesizedAudio {
  const totalSamples = samples.length;
  // Audio Analysis
  let peak = 0;
  let sumSquares = 0;
  let zeroCrossings = 0;
  let prevSample = 0;

  for (let i = 0; i < totalSamples; i++) {
    const s = samples[i];
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSquares += s * s;
    if (i > 0 && ((prevSample >= 0 && s < 0) || (prevSample < 0 && s >= 0))) {
      zeroCrossings++;
    }
    prevSample = s;
  }

  const rms = Math.sqrt(sumSquares / totalSamples);
  const peakDbfs = peak > 0.00001 ? Math.max(-96, Math.min(0, 20 * Math.log10(peak))) : -96;
  const analysis: AudioAnalysis = {
    peakLinear: peak,
    peakDbfs: Math.round(peakDbfs * 10) / 10,
    rms: Math.round(rms * 1000) / 1000,
    zeroCrossings,
    hasClipping: peak >= 0.999,
  };

  // Waveform visualization downsampling (128 visual peaks)
  const numVisualPeaks = 128;
  const waveformPeaks: WaveformPeak[] = [];

  for (let p = 0; p < numVisualPeaks; p++) {
    const start = Math.floor(p * totalSamples / numVisualPeaks);
    const end = Math.floor((p + 1) * totalSamples / numVisualPeaks);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = samples[j];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    waveformPeaks.push({ min, max });
  }

  // Encode WAV bytes
  const wavBytes = encodeWav(samples, sampleRate);

  return {
    samples,
    wavBytes,
    analysis,
    waveformPeaks,
    issues: [],
  };
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      !samples.length || samples.length > sampleRate * 600 || samples.some((value) => !Number.isFinite(value))) {
    throw new Error('Buffer atau sample rate WAV tidak sah.');
  }
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM 16-bit signed samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1] then scale to 16-bit integer
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, Math.floor(intSample), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function renderWaveformSvg(peaks: WaveformPeak[], width = 480, height = 120, accent = '#ff405f'): string {
  if (!peaks.length) return '';
  const midY = height / 2;
  const step = width / peaks.length;

  let upperPath = `M 0 ${midY}`;
  let lowerPath = '';

  for (let i = 0; i < peaks.length; i++) {
    const x = i * step;
    const yTop = midY - peaks[i].max * (midY - 6);
    const yBottom = midY - peaks[i].min * (midY - 6);
    upperPath += ` L ${x.toFixed(1)} ${yTop.toFixed(1)}`;
    lowerPath = ` L ${x.toFixed(1)} ${yBottom.toFixed(1)}` + lowerPath;
  }

  const fullPath = `${upperPath} L ${width} ${midY} ${lowerPath} Z`;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="waveform-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.85" />
          <stop offset="50%" stop-color="${accent}" stop-opacity="0.25" />
          <stop offset="100%" stop-color="${accent}" stop-opacity="0.85" />
        </linearGradient>
      </defs>
      <line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="${accent}" stroke-opacity="0.2" stroke-dasharray="4 4" />
      <path d="${fullPath}" fill="url(#waveform-grad)" stroke="${accent}" stroke-width="1.2" stroke-linejoin="round" />
    </svg>`;
}

export const sfxPresets: Record<SfxCategory, Omit<SfxRecipe, 'name' | 'seed'>> = {
  coin: {
    schemaVersion: 1,
    category: 'coin',
    waveform: 'sine',
    durationMs: 140,
    frequencyStart: 987,
    frequencyEnd: 1318,
    attackMs: 2,
    decayMs: 60,
    sustain: 0.1,
    releaseMs: 70,
    filterCutoff: 8000,
    noiseMix: 0,
    volume: 0.75,
    loop: false,
  },
  laser: {
    schemaVersion: 1,
    category: 'laser',
    waveform: 'sawtooth',
    durationMs: 200,
    frequencyStart: 1800,
    frequencyEnd: 120,
    attackMs: 2,
    decayMs: 120,
    sustain: 0.15,
    releaseMs: 70,
    filterCutoff: 5000,
    noiseMix: 0.05,
    volume: 0.8,
    loop: false,
  },
  explosion: {
    schemaVersion: 1,
    category: 'explosion',
    waveform: 'noise',
    durationMs: 750,
    frequencyStart: 320,
    frequencyEnd: 40,
    attackMs: 5,
    decayMs: 400,
    sustain: 0.25,
    releaseMs: 340,
    filterCutoff: 1200,
    noiseMix: 0.85,
    volume: 0.85,
    loop: false,
  },
  jump: {
    schemaVersion: 1,
    category: 'jump',
    waveform: 'square',
    durationMs: 180,
    frequencyStart: 180,
    frequencyEnd: 540,
    attackMs: 4,
    decayMs: 90,
    sustain: 0.3,
    releaseMs: 80,
    filterCutoff: 3000,
    noiseMix: 0,
    volume: 0.7,
    loop: false,
  },
  powerup: {
    schemaVersion: 1,
    category: 'powerup',
    waveform: 'triangle',
    durationMs: 420,
    frequencyStart: 260,
    frequencyEnd: 1040,
    attackMs: 10,
    decayMs: 200,
    sustain: 0.4,
    releaseMs: 200,
    filterCutoff: 6500,
    noiseMix: 0.02,
    volume: 0.8,
    loop: false,
  },
  hit: {
    schemaVersion: 1,
    category: 'hit',
    waveform: 'square',
    durationMs: 120,
    frequencyStart: 380,
    frequencyEnd: 70,
    attackMs: 2,
    decayMs: 70,
    sustain: 0.1,
    releaseMs: 40,
    filterCutoff: 2400,
    noiseMix: 0.2,
    volume: 0.8,
    loop: false,
  },
  ui_click: {
    schemaVersion: 1,
    category: 'ui_click',
    waveform: 'sine',
    durationMs: 65,
    frequencyStart: 1400,
    frequencyEnd: 900,
    attackMs: 1,
    decayMs: 35,
    sustain: 0.05,
    releaseMs: 25,
    filterCutoff: 9000,
    noiseMix: 0,
    volume: 0.65,
    loop: false,
  },
  footstep: {
    schemaVersion: 1,
    category: 'footstep',
    waveform: 'noise',
    durationMs: 95,
    frequencyStart: 200,
    frequencyEnd: 60,
    attackMs: 4,
    decayMs: 50,
    sustain: 0.1,
    releaseMs: 40,
    filterCutoff: 800,
    noiseMix: 0.6,
    volume: 0.7,
    loop: false,
  },
};
