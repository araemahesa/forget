import type { TexturePattern, TextureSpec, ValidationIssue } from '@forgekit/contracts';
import { Select } from '../../design-system/Select';
import { TextField } from '../../design-system/TextField';

const patternOptions: { value: TexturePattern; label: string }[] = [
  { value: 'bricks', label: 'Bata (Bricks)' },
  { value: 'wood', label: 'Kayu (Wood Planks)' },
  { value: 'metal_grid', label: 'Kisi Logam (Metal Grid)' },
  { value: 'hex_tiles', label: 'Ubin Segienam (Hex Tiles)' },
  { value: 'fabric', label: 'Kain (Fabric Weave)' },
  { value: 'stone', label: 'Batu (Flagstone)' },
  { value: 'noise', label: 'Noise Prosedural' },
];

const resolutionOptions = [
  { value: '128', label: '128 × 128 px (Ringan)' },
  { value: '256', label: '256 × 256 px (Standar)' },
  { value: '512', label: '512 × 512 px (Detail)' },
];

export function TextureForm({
  spec,
  issues,
  onChange,
  onRender,
}: {
  spec: TextureSpec;
  issues: ValidationIssue[];
  onChange: (patch: Partial<TextureSpec>) => void;
  onRender: () => void;
}) {
  const errorFor = (path: string) =>
    issues.find((issue) => issue.path === path && issue.severity === 'error')?.message;

  const randomizeSeed = () => {
    onChange({ seed: Math.floor(Math.random() * 1000000) });
  };

  return (
    <form
      className="gfx-form texture-form"
      id="texture-brief"
      onSubmit={(event) => {
        event.preventDefault();
        onRender();
      }}
    >
      <fieldset className="form-section">
        <legend>Identitas & Pola</legend>
        <TextField
          label="Nama tekstur"
          value={spec.name}
          onChange={(name) => onChange({ name })}
          error={errorFor('name')}
        />
        <Select
          label="Pola permukaan"
          options={patternOptions}
          value={spec.pattern}
          onChange={(pattern) => onChange({ pattern: pattern as TexturePattern })}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>Warna Permukaan</legend>
        <div className="field-row">
          <div className="color-field">
            <TextField
              label="Warna dasar"
              value={spec.baseColor}
              onChange={(baseColor) => onChange({ baseColor })}
              error={errorFor('baseColor')}
            />
            <input
              className="color-swatch"
              type="color"
              aria-label="Pilih warna dasar"
              value={/^#[0-9a-f]{6}$/i.test(spec.baseColor) ? spec.baseColor : '#8b4513'}
              onChange={(event) => onChange({ baseColor: event.target.value })}
            />
          </div>
          <div className="color-field">
            <TextField
              label="Warna aksen / nat"
              value={spec.accentColor}
              onChange={(accentColor) => onChange({ accentColor })}
              error={errorFor('accentColor')}
            />
            <input
              className="color-swatch"
              type="color"
              aria-label="Pilih warna aksen"
              value={/^#[0-9a-f]{6}$/i.test(spec.accentColor) ? spec.accentColor : '#d2691e'}
              onChange={(event) => onChange({ accentColor: event.target.value })}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Sifat Material PBR</legend>
        <div className="field-row">
          <TextField
            label="Roughness (Kekasaran)"
            type="number"
            value={spec.roughness}
            onChange={(roughness) => onChange({ roughness: Number(roughness) })}
            error={errorFor('roughness')}
          />
          <TextField
            label="Metalness (Logam)"
            type="number"
            value={spec.metalness}
            onChange={(metalness) => onChange({ metalness: Number(metalness) })}
            error={errorFor('metalness')}
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Skala & Pengacakan</legend>
        <div className="field-row">
          <TextField
            label="Skala pengulangan (1–16)"
            type="number"
            value={spec.scale}
            onChange={(scale) => onChange({ scale: Math.round(Number(scale)) })}
            error={errorFor('scale')}
          />
          <div className="seed-field-row">
            <TextField
              label="Seed pengacakan"
              type="number"
              value={spec.seed}
              onChange={(seed) => onChange({ seed: Math.round(Number(seed)) })}
              error={errorFor('seed')}
            />
            <button
              type="button"
              className="button secondary-button seed-random-button"
              onClick={randomizeSeed}
              title="Acak pola permukaan"
              aria-label="Acak seed"
            >
              Acak
            </button>
          </div>
        </div>
        <Select
          label="Resolusi ekspor"
          options={resolutionOptions}
          value={String(spec.resolution)}
          onChange={(res) => onChange({ resolution: Number(res) as TextureSpec['resolution'] })}
        />
      </fieldset>
    </form>
  );
}
