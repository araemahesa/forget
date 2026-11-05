import type { IconSpec, IconShape, IconStyle, ValidationIssue } from '@forgekit/contracts';
import { Select } from '../../design-system/Select';
import { TextField } from '../../design-system/TextField';
import { IconGlyphPicker } from './IconGlyphPicker';

const shapeOptions = [
  { value: 'none', label: 'Tanpa bingkai' },
  { value: 'circle', label: 'Lingkaran' },
  { value: 'rounded', label: 'Kotak bulat' },
  { value: 'squircle', label: 'Squircle' },
  { value: 'hexagon', label: 'Segienam' },
  { value: 'shield', label: 'Perisai' },
] as const;

const styleOptions = [
  { value: 'duotone', label: 'Dua warna (Duotone)' },
  { value: 'outline', label: 'Garis tepi (Outline)' },
  { value: 'solid', label: 'Padat (Solid)' },
] as const;

export function IconForm({
  spec,
  issues,
  onChange,
  onRender,
}: {
  spec: IconSpec;
  issues: ValidationIssue[];
  onChange: (patch: Partial<IconSpec>) => void;
  onRender: () => void;
}) {
  const errorFor = (path: string) =>
    issues.find((issue) => issue.path === path && issue.severity === 'error')?.message;

  return (
    <form
      className="gfx-form icon-form"
      id="icon-brief"
      onSubmit={(event) => {
        event.preventDefault();
        onRender();
      }}
    >
      <fieldset className="form-section">
        <legend>Simbol & Identitas</legend>
        <TextField
          label="Nama ikon"
          value={spec.name}
          onChange={(name) => onChange({ name })}
          error={errorFor('name')}
        />
        <div className="field">
          <span>Pilih Simbol</span>
          <IconGlyphPicker
            selected={spec.glyph}
            onSelect={(glyph) => onChange({ glyph })}
            primaryColor={spec.primaryColor}
            secondaryColor={spec.secondaryColor}
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Bentuk & Gaya</legend>
        <Select
          label="Bentuk bingkai"
          options={shapeOptions}
          value={spec.shape}
          onChange={(shape) => onChange({ shape: shape as IconShape })}
        />
        <Select
          label="Gaya tampilan"
          options={styleOptions}
          value={spec.style}
          onChange={(style) => onChange({ style: style as IconStyle })}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>Warna & Palet</legend>
        <div className="field-row">
          <div className="color-field">
            <TextField
              label="Warna utama"
              value={spec.primaryColor}
              onChange={(primaryColor) => onChange({ primaryColor })}
              error={errorFor('primaryColor')}
            />
            <input
              className="color-swatch"
              type="color"
              aria-label="Pilih warna utama"
              value={/^#[0-9a-f]{6}$/i.test(spec.primaryColor) ? spec.primaryColor : '#ff405f'}
              onChange={(event) => onChange({ primaryColor: event.target.value })}
            />
          </div>
          {spec.style === 'duotone' ? (
            <div className="color-field">
              <TextField
                label="Warna sekunder"
                value={spec.secondaryColor}
                onChange={(secondaryColor) => onChange({ secondaryColor })}
                error={errorFor('secondaryColor')}
              />
              <input
                className="color-swatch"
                type="color"
                aria-label="Pilih warna sekunder"
                value={/^#[0-9a-f]{6}$/i.test(spec.secondaryColor) ? spec.secondaryColor : '#ffd166'}
                onChange={(event) => onChange({ secondaryColor: event.target.value })}
              />
            </div>
          ) : null}
        </div>
        <div className="color-field">
          <TextField
            label="Latar belakang"
            value={spec.background}
            onChange={(background) => onChange({ background })}
            error={errorFor('background')}
          />
          <input
            className="color-swatch"
            type="color"
            aria-label="Pilih warna latar"
            value={/^#[0-9a-f]{6}$/i.test(spec.background) ? spec.background : '#171417'}
            onChange={(event) => onChange({ background: event.target.value })}
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Geometri & Skala</legend>
        <div className="field-row">
          <TextField
            label="Ketebalan garis"
            type="number"
            value={spec.strokeWidth}
            onChange={(strokeWidth) => onChange({ strokeWidth: Number(strokeWidth) })}
            error={errorFor('strokeWidth')}
          />
          <TextField
            label="Jarak tepi (padding)"
            type="number"
            value={spec.padding}
            onChange={(padding) => onChange({ padding: Number(padding) })}
            error={errorFor('padding')}
          />
        </div>
        <TextField
          label="Ukuran kanvas (px)"
          type="number"
          value={spec.size}
          onChange={(size) => onChange({ size: Number(size) })}
          error={errorFor('size')}
        />
      </fieldset>
    </form>
  );
}
