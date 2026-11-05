import { StudioApply } from '../create/StudioApply';
import { VfxPreview } from './VfxPreview';
import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useState } from 'react';
import type { VfxRecipe } from '@forgekit/contracts';
import { validateVfxRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';

const defaultRecipe: VfxRecipe = {
  name: 'DragonFlame_Burst',
  type: 'burst',
  rate: 80,
  lifetime: [0.5, 1.2],
  speed: [8, 16],
  spread: 45,
  startColor: '#ffaa00',
  endColor: '#ff2200',
  sizeStart: 2.5,
  sizeEnd: 0.2,
  lightEmission: 0.9,
};

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function VfxPage() {
  const task = useCreativeTask('vfx');
  const [recipe, setRecipe] = useState<VfxRecipe>(defaultRecipe);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (task.version?.document.kind === 'vfx') {
      setRecipe(task.version.document.recipe);
    }
  }, [task.version]);

  const errors = validateVfxRecipe(recipe);
  const changed = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);

  return (
    <section className="procedural-workspace">
      <div className="procedural-heading">
        <div>
          <h1>Efek Visual (VFX)</h1>
          <p>Prompt menjadi konfigurasi emitter partikel, beam, dan trail dinamis untuk Roblox Studio.</p>
        </div>
        <span className="capability-note">Partikel, beam & trail 3D</span>
      </div>

      <div className="procedural-layout">
        <aside className="generator-inspector" aria-label="Kontrol Efek Visual">
          <CreativeControls task={task} initialPrompt="Buat efek semburan api naga merah keemasan." />

          <details>
            <summary>Editor lanjutan</summary>
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label htmlFor="vfx-name">Nama Efek</label>
              <input
                id="vfx-name"
                className="text-input"
                value={recipe.name}
                onChange={(e) => setRecipe({ ...recipe, name: e.target.value })}
                disabled={task.busy}
              />
            </div>

            <div className="form-group">
              <label htmlFor="vfx-type">Tipe Emitter</label>
              <Dropdown
                id="vfx-type"
                className="select-input"
                value={recipe.type}
                onChange={(e) => setRecipe({ ...recipe, type: e.target.value as VfxRecipe['type'] })}
                disabled={task.busy}
              >
                <option value="particles">Partikel Berkelanjutan (Continuous)</option>
                <option value="burst">Ledakan / Semburan (Burst)</option>
                <option value="beam">Berkas Cahaya (Beam)</option>
                <option value="trail">Jejak Senjata / Gerak (Trail)</option>
              </Dropdown>
            </div>

            <div className="form-group">
              <div className="label-row">
                <label htmlFor="vfx-rate">Laju Emisi (Rate)</label>
                <span className="slider-val">{recipe.rate} / detik</span>
              </div>
              <input
                id="vfx-rate"
                type="range"
                min={5}
                max={300}
                value={recipe.rate}
                onChange={(e) => setRecipe({ ...recipe, rate: Number(e.target.value) })}
                disabled={task.busy}
              />
            </div>

            <div className="form-group color-row">
              <div>
                <label htmlFor="vfx-start-col">Warna Awal</label>
                <input
                  id="vfx-start-col"
                  type="color"
                  className="color-input"
                  value={recipe.startColor}
                  onChange={(e) => setRecipe({ ...recipe, startColor: e.target.value })}
                  disabled={task.busy}
                />
              </div>
              <div>
                <label htmlFor="vfx-end-col">Warna Akhir</label>
                <input
                  id="vfx-end-col"
                  type="color"
                  className="color-input"
                  value={recipe.endColor}
                  onChange={(e) => setRecipe({ ...recipe, endColor: e.target.value })}
                  disabled={task.busy}
                />
              </div>
            </div>

            {errors.length > 0 && (
              <div className="alert alert-error" style={{ margin: '8px 0' }}>
                <Icon name="alert" />
                <span>{errors[0].message}</span>
              </div>
            )}

            <button
              type="button"
              className="button secondary-button"
              style={{ marginTop: '8px', width: '100%' }}
              disabled={!changed || errors.length > 0 || task.busy}
              onClick={() => void task.run('Revisi editor manual', task.version?.id ?? null, { kind: 'vfx', recipe })}
            >
              Simpan revisi editor
            </button>
          </details>
        </aside>

        <div className="procedural-canvas">
          <div className="viewport-toolbar">
            <span>{recipe.name} ({recipe.type})</span>
            <button
              type="button"
              className="button secondary-button btn-sm"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              <Icon name={isPlaying ? 'close' : 'spark'} />
              <span>{isPlaying ? 'Jeda' : 'Putar'}</span>
            </button>
          </div>

          <VfxPreview recipe={recipe} playing={isPlaying} />

          <p className="generator-caption" style={{ marginTop: '12px' }}>
            Parameter: laju emisi {recipe.rate}/s, rentang kecepatan [{recipe.speed.join(', ')}], warna awal {recipe.startColor} → {recipe.endColor}.
          </p>

          <div className="generator-actions" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => downloadJson(recipe, `${recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_vfx.json`)}
            >
              <Icon name="download" /> Ekspor JSON
            </button>
            <StudioApply task={task} changed={!!changed} />
          </div>
          <details className="preview-runtime-details"><summary>Penerapan & verifikasi Studio</summary><p id="vfx-apply-reason" className="generator-caption">Versi tersimpan diterapkan melalui provider pilihan pada map terverifikasi. Target dikunci; hasil diperiksa kembali. Pemasangan di Edit tidak membuktikan perilaku saat Play.</p></details>
        </div>
      </div>
    </section>
  );
}
