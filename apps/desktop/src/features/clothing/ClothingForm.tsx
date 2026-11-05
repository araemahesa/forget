import type { ClothingKind, ClothingPattern, ClothingSpec, NeckStyle, ValidationIssue } from '@forgekit/contracts';
import { Select } from '../../design-system/Select';
import { TextField } from '../../design-system/TextField';

const kindOptions: { value: ClothingKind; label: string }[] = [
  { value: 'shirt', label: 'Kemeja / Baju (Shirt · 585×559)' },
  { value: 'pants', label: 'Celana (Pants · 585×559)' },
  { value: 'tshirt', label: 'Kaos Grafis (T-Shirt · 512×512)' },
];

const patternOptions: { value: ClothingPattern; label: string }[] = [
  { value: 'solid', label: 'Polos (Solid Color)' },
  { value: 'stripes', label: 'Garis-garis (Stripes)' },
  { value: 'denim', label: 'Jeans Denim' },
  { value: 'camo', label: 'Loreng Kamuflase (Camo)' },
  { value: 'hoodie', label: 'Jaket Hoodie (Saku Depan)' },
  { value: 'plaid', label: 'Kotak-kotak (Plaid Flanel)' },
];

const neckOptions: { value: NeckStyle; label: string }[] = [
  { value: 'round', label: 'Leher Bulat (Round Neck)' },
  { value: 'v_neck', label: 'Kerah V (V-Neck)' },
  { value: 'collar', label: 'Kerah Kemeja (Collar)' },
  { value: 'crew', label: 'Kerah Rib Crewneck' },
];

export function ClothingForm({
  spec,
  issues,
  onChange,
  onRender,
}: {
  spec: ClothingSpec;
  issues: ValidationIssue[];
  onChange: (patch: Partial<ClothingSpec>) => void;
  onRender: () => void;
}) {
  const errorFor = (path: string) =>
    issues.find((issue) => issue.path === path && issue.severity === 'error')?.message;

  return (
    <form
      className="gfx-form clothing-form"
      id="clothing-brief"
      onSubmit={(event) => {
        event.preventDefault();
        onRender();
      }}
    >
      <fieldset className="form-section">
        <legend>Identitas & Jenis Pakaian</legend>
        <TextField
          label="Nama pakaian"
          value={spec.name}
          onChange={(name) => onChange({ name })}
          error={errorFor('name')}
        />
        <Select
          label="Jenis pakaian"
          options={kindOptions}
          value={spec.kind}
          onChange={(kind) => onChange({ kind: kind as ClothingKind })}
        />
        <Select
          label="Pola bahan"
          options={patternOptions}
          value={spec.pattern}
          onChange={(pattern) => onChange({ pattern: pattern as ClothingPattern })}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>Palet Warna Pakaian</legend>
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
              value={/^#[0-9a-f]{6}$/i.test(spec.baseColor) ? spec.baseColor : '#2c3e50'}
              onChange={(event) => onChange({ baseColor: event.target.value })}
            />
          </div>
          <div className="color-field">
            <TextField
              label="Warna aksen"
              value={spec.accentColor}
              onChange={(accentColor) => onChange({ accentColor })}
              error={errorFor('accentColor')}
            />
            <input
              className="color-swatch"
              type="color"
              aria-label="Pilih warna aksen"
              value={/^#[0-9a-f]{6}$/i.test(spec.accentColor) ? spec.accentColor : '#e74c3c'}
              onChange={(event) => onChange({ accentColor: event.target.value })}
            />
          </div>
        </div>

        <div className="color-field">
          <TextField
            label="Warna manset / kerah"
            value={spec.cuffColor}
            onChange={(cuffColor) => onChange({ cuffColor })}
            error={errorFor('cuffColor')}
          />
          <input
            className="color-swatch"
            type="color"
            aria-label="Pilih warna manset"
            value={/^#[0-9a-f]{6}$/i.test(spec.cuffColor) ? spec.cuffColor : '#1a252f'}
            onChange={(event) => onChange({ cuffColor: event.target.value })}
          />
        </div>
      </fieldset>

      {spec.kind !== 'pants' && (
        <fieldset className="form-section">
          <legend>Kerah & Detail Baju</legend>
          <Select
            label="Bentuk kerah"
            options={neckOptions}
            value={spec.neckStyle}
            onChange={(neckStyle) => onChange({ neckStyle: neckStyle as NeckStyle })}
          />
          <label className="checkbox-field clothing-toggle">
            <input
              type="checkbox"
              checked={spec.pocket}
              onChange={(event) => onChange({ pocket: event.target.checked })}
            />
            <span>Tambahkan saku baju depan</span>
          </label>
        </fieldset>
      )}

      <fieldset className="form-section">
        <legend>Finishing & Panduan</legend>
        <label className="checkbox-field clothing-toggle">
          <input
            type="checkbox"
            checked={spec.shading}
            onChange={(event) => onChange({ shading: event.target.checked })}
          />
          <span>Efek bayangan lipatan kain (Shading)</span>
        </label>
        <label className="checkbox-field clothing-toggle">
          <input
            type="checkbox"
            checked={spec.templateGuide}
            onChange={(event) => onChange({ templateGuide: event.target.checked })}
          />
          <span>Tampilkan garis panduan & label Roblox</span>
        </label>
      </fieldset>
    </form>
  );
}
