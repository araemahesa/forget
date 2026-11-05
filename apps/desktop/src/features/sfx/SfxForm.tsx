import type { SfxCategory, SfxRecipe, ValidationIssue, WaveformType } from '@forgekit/contracts';
import { Select } from '../../design-system/Select';
import { TextField } from '../../design-system/TextField';
import { sfxPresets } from '../../engines/sfx/dsp';

const categoryOptions: { value: SfxCategory; label: string }[] = [
  { value: 'coin', label: 'Koin / Pickup (Coin)' },
  { value: 'laser', label: 'Tembakan Laser (Blaster)' },
  { value: 'explosion', label: 'Ledakan (Explosion)' },
  { value: 'jump', label: 'Lompat (Jump)' },
  { value: 'powerup', label: 'Power-up / Level Up' },
  { value: 'hit', label: 'Benturan / Kena Pukul (Hit)' },
  { value: 'ui_click', label: 'Klik UI / Menu' },
  { value: 'footstep', label: 'Langkah Kaki (Footstep)' },
];

const waveformOptions: { value: WaveformType; label: string }[] = [
  { value: 'sine', label: 'Sine (Lembut & Bersih)' },
  { value: 'square', label: 'Square (Retro 8-bit)' },
  { value: 'sawtooth', label: 'Sawtooth (Tajam & Agresif)' },
  { value: 'triangle', label: 'Triangle (Bulat & Berbobot)' },
  { value: 'noise', label: 'White Noise (Ledakan & Gemuruh)' },
];

export function SfxForm({
  recipe,
  issues,
  onChange,
  onSynthesize,
}: {
  recipe: SfxRecipe;
  issues: ValidationIssue[];
  onChange: (patch: Partial<SfxRecipe>) => void;
  onSynthesize: () => void;
}) {
  const errorFor = (path: string) =>
    issues.find((issue) => issue.path === path && issue.severity === 'error')?.message;

  const handleCategoryChange = (category: SfxCategory) => {
    const preset = sfxPresets[category];
    onChange({
      ...preset,
    });
  };

  const randomizeSeed = () => {
    onChange({ seed: Math.floor(Math.random() * 1000000) });
  };

  return (
    <form
      className="gfx-form sfx-form"
      id="sfx-brief"
      onSubmit={(event) => {
        event.preventDefault();
        onSynthesize();
      }}
    >
      <fieldset className="form-section">
        <legend>Preset & Gelombang Suara</legend>
        <TextField
          label="Nama efek suara"
          value={recipe.name}
          onChange={(name) => onChange({ name })}
          error={errorFor('name')}
        />
        <Select
          label="Kategori preset"
          options={categoryOptions}
          value={recipe.category}
          onChange={(cat) => handleCategoryChange(cat as SfxCategory)}
        />
        <Select
          label="Bentuk gelombang (Oscillator)"
          options={waveformOptions}
          value={recipe.waveform}
          onChange={(waveform) => onChange({ waveform: waveform as WaveformType })}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>Frekuensi & Durasi</legend>
        <div className="field-row">
          <TextField
            label="Frekuensi awal (Hz)"
            type="number"
            value={recipe.frequencyStart}
            onChange={(val) => onChange({ frequencyStart: Number(val) })}
            error={errorFor('frequencyStart')}
          />
          <TextField
            label="Frekuensi akhir (Hz)"
            type="number"
            value={recipe.frequencyEnd}
            onChange={(val) => onChange({ frequencyEnd: Number(val) })}
            error={errorFor('frequencyEnd')}
          />
        </div>
        <div className="field-row">
          <TextField
            label="Durasi (ms · 50–3000)"
            type="number"
            value={recipe.durationMs}
            onChange={(val) => onChange({ durationMs: Math.round(Number(val)) })}
            error={errorFor('durationMs')}
          />
          <TextField
            label="Filter cutoff (Hz)"
            type="number"
            value={recipe.filterCutoff}
            onChange={(val) => onChange({ filterCutoff: Number(val) })}
            error={errorFor('filterCutoff')}
          />
        </div>
      </fieldset>

      <details className="sfx-advanced">
        <summary>Envelope & variasi lanjutan</summary>
        <div className="sfx-advanced-fields">
          <fieldset className="form-section">
            <legend>Envelope ADSR (Amplitudo)</legend>
            <div className="field-row">
              <TextField
                label="Attack (ms)"
                type="number"
                value={recipe.attackMs}
                onChange={(val) => onChange({ attackMs: Number(val) })}
                error={errorFor('attackMs')}
              />
              <TextField
                label="Decay (ms)"
                type="number"
                value={recipe.decayMs}
                onChange={(val) => onChange({ decayMs: Number(val) })}
                error={errorFor('decayMs')}
              />
            </div>
            <div className="field-row">
              <TextField
                label="Sustain (0.0–1.0)"
                type="number"
                value={recipe.sustain}
                onChange={(val) => onChange({ sustain: Number(val) })}
                error={errorFor('sustain')}
              />
              <TextField
                label="Release (ms)"
                type="number"
                value={recipe.releaseMs}
                onChange={(val) => onChange({ releaseMs: Number(val) })}
                error={errorFor('releaseMs')}
              />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>Tekstur Noise & Output</legend>
            <div className="field-row">
              <TextField
                label="Campuran Noise (0.0–1.0)"
                type="number"
                value={recipe.noiseMix}
                onChange={(val) => onChange({ noiseMix: Number(val) })}
                error={errorFor('noiseMix')}
              />
              <TextField
                label="Volume (0.05–1.0)"
                type="number"
                value={recipe.volume}
                onChange={(val) => onChange({ volume: Number(val) })}
                error={errorFor('volume')}
              />
            </div>
            <div className="seed-field-row">
              <TextField
                label="Seed pengacakan"
                type="number"
                value={recipe.seed}
                onChange={(seed) => onChange({ seed: Math.round(Number(seed)) })}
                error={errorFor('seed')}
              />
              <button
                type="button"
                className="button secondary-button seed-random-button"
                onClick={randomizeSeed}
                title="Acak variasi suara"
                aria-label="Acak seed"
              >
                Acak
              </button>
            </div>
            <label className="checkbox-field sfx-toggle">
              <input
                type="checkbox"
                checked={recipe.loop}
                onChange={(event) => onChange({ loop: event.target.checked })}
              />
              <span>Putar ulang otomatis (Loop)</span>
            </label>
          </fieldset>
        </div>
      </details>
    </form>
  );
}
