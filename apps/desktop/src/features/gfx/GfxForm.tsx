import type { GfxSpec, ValidationIssue } from '@forgekit/contracts';
import { Select } from '../../design-system/Select';
import { TextField } from '../../design-system/TextField';

export function GfxForm({
  spec,
  issues,
  onChange,
  onRender,
}: {
  spec: GfxSpec;
  issues: ValidationIssue[];
  onChange: (patch: Partial<GfxSpec>) => void;
  onRender: () => void;
}) {
  const ratios = [{ value: 'custom', label: 'Kustom (ubah dimensi)' }, { value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '4:3', label: '4:3' }];
  const ratio = ratios.find(({ value }) => {
    const [width, height] = value.split(':').map(Number);
    return spec.width * height === spec.height * width;
  })?.value ?? 'custom';
  const changeRatio = (value: string) => {
    if (value === 'custom') return;
    const [width, height] = value.split(':').map(Number);
    const scale = Math.max(Math.ceil(128 / Math.min(width, height)), Math.min(Math.floor(4096 / Math.max(width, height)), Math.round(spec.width / width)));
    onChange({ width: width * scale, height: height * scale });
  };
  const errorFor = (path: string) => issues.find((issue) => issue.path === path && issue.severity === 'error')?.message;
  return (
    <form className="gfx-form" id="gfx-brief" onSubmit={(event) => { event.preventDefault(); onRender(); }}>
      <fieldset className="form-section">
        <legend>Teks</legend>
      <TextField label="Judul" value={spec.title} onChange={(title) => onChange({ title })} error={errorFor('title')} />
      <TextField label="Subjudul" value={spec.subtitle} onChange={(subtitle) => onChange({ subtitle })} error={errorFor('subtitle')} />
      </fieldset>
      <fieldset className="form-section">
        <legend>Komposisi</legend>
      <div className="field-row">
        <div className="color-field"><TextField label="Latar" value={spec.background} onChange={(background) => onChange({ background })} error={errorFor('background')} /><input className="color-swatch" type="color" aria-label="Pilih warna latar" value={/^#[0-9a-f]{6}$/i.test(spec.background) ? spec.background : '#101216'} onChange={(event) => onChange({ background: event.target.value })} /></div>
        <div className="color-field"><TextField label="Aksen" value={spec.accent} onChange={(accent) => onChange({ accent })} error={errorFor('accent')} /><input className="color-swatch" type="color" aria-label="Pilih warna aksen" value={/^#[0-9a-f]{6}$/i.test(spec.accent) ? spec.accent : '#ff0033'} onChange={(event) => onChange({ accent: event.target.value })} /></div>
      </div>
      <Select
        label="Tata letak"
        options={[{ value: 'centered', label: 'Tengah' }, { value: 'split', label: 'Terbagi' }, { value: 'stacked', label: 'Bertumpuk' }]}
        value={spec.layout}
        onChange={(layout) => onChange({ layout: layout as GfxSpec['layout'] })}
      />
      </fieldset>
      <fieldset className="form-section">
        <legend>Ukuran</legend>
      <Select label="Rasio aspek" options={ratios} value={ratio} onChange={changeRatio} />
      <div className="field-row">
        <TextField label="Lebar" type="number" value={spec.width} onChange={(width) => onChange({ width: Number(width) })} error={errorFor('width')} />
        <TextField label="Tinggi" type="number" value={spec.height} onChange={(height) => onChange({ height: Number(height) })} error={errorFor('height')} />
      </div>
      </fieldset>
    </form>
  );
}
