import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useState } from 'react';
import type { Texture3dRecipe } from '@forgekit/contracts';
import { validateTexture3dRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';

const defaultRecipe: Texture3dRecipe = {
  modelName: 'KnightHelmet_Mesh',
  resolution: 1024,
  generateNormalMap: true,
  layers: [
    { id: 'l1', name: 'Base Metal', blendMode: 'normal', opacity: 1.0, color: '#4a5568', roughness: 0.25, metalness: 0.9, visible: true },
    { id: 'l2', name: 'Gold Trim Accents', blendMode: 'overlay', opacity: 0.8, color: '#ecc94b', roughness: 0.3, metalness: 0.95, visible: true },
    { id: 'l3', name: 'Edge Dirt & Grime', blendMode: 'multiply', opacity: 0.4, color: '#2d3748', roughness: 0.8, metalness: 0.1, visible: true },
  ],
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

export function Texture3dPage() {
  const task = useCreativeTask('material');
  const [recipe, setRecipe] = useState<Texture3dRecipe>(defaultRecipe);

  useEffect(() => {
    if (task.version?.document.kind === 'material') {
      setRecipe(task.version.document.recipe);
    }
  }, [task.version]);

  const errors = validateTexture3dRecipe(recipe);
  const changed = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);
  const visible = recipe.layers.filter((layer) => layer.visible);
  const channel = (key: 'roughness' | 'metalness') => visible.map((layer) => `rgb(${Math.round(layer[key] * 255)} ${Math.round(layer[key] * 255)} ${Math.round(layer[key] * 255)})`);
  const gradient = (values: string[]) => `linear-gradient(135deg, ${(values.length > 1 ? values : [values[0] ?? '#000000', values[0] ?? '#000000']).join(', ')})`;

  const toggleLayer = (id: string) => {
    setRecipe({
      ...recipe,
      layers: recipe.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    });
  };

  return (
    <section className="procedural-workspace">
      <div className="procedural-heading">
        <div>
          <h1>Material 3D (SurfaceAppearance)</h1>
          <p>Prompt menjadi konfigurasi layer PBR (Color, Roughness, Metalness, Normal) untuk Roblox Studio.</p>
        </div>
        <span className="capability-note">Roblox PBR Material: Prosedural</span>
      </div>

      <div className="procedural-layout">
        <aside className="generator-inspector" aria-label="Kontrol Material 3D">
          <CreativeControls task={task} initialPrompt="Buat material logam berkarat dengan aksen emas." />

          <details>
            <summary>Editor lanjutan</summary>
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label htmlFor="tex3d-model">Nama Model Sasaran</label>
              <input
                id="tex3d-model"
                className="text-input"
                value={recipe.modelName}
                onChange={(e) => setRecipe({ ...recipe, modelName: e.target.value })}
                disabled={task.busy}
              />
            </div>

            <div className="form-group">
              <label htmlFor="tex3d-res">Resolusi Channel</label>
              <Dropdown
                id="tex3d-res"
                className="select-input"
                value={recipe.resolution}
                onChange={(e) => setRecipe({ ...recipe, resolution: Number(e.target.value) as 512 | 1024 | 2048 })}
                disabled={task.busy}
              >
                <option value={512}>512 × 512 (Ringan)</option>
                <option value={1024}>1024 × 1024 (Standar Roblox)</option>
                <option value={2048}>2048 × 2048 (High Definition)</option>
              </Dropdown>
            </div>

            <div className="form-group">
              <label>Daftar Layer Material</label>
              <div className="layer-stack" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                {recipe.layers.map((layer) => (
                  <div key={layer.id} className="layer-item" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', background: '#18151a', borderRadius: '4px' }}>
                    <button
                      type="button"
                      className={`layer-toggle ${layer.visible ? 'active' : ''}`}
                      onClick={() => toggleLayer(layer.id)}
                      aria-label={`Toggle layer ${layer.name}`}
                      style={{ background: 'transparent', border: 'none', color: layer.visible ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}
                      disabled={task.busy}
                    >
                      <Icon name={layer.visible ? 'check' : 'close'} />
                    </button>
                    <span className="layer-color-dot" style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: layer.color }} />
                    <span className="layer-name" style={{ fontSize: '12px', flex: 1 }}>{layer.name}</span>
                    <span className="layer-blend" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{layer.blendMode}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group checkbox-group" style={{ marginTop: '8px' }}>
              <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={recipe.generateNormalMap}
                  onChange={(e) => setRecipe({ ...recipe, generateNormalMap: e.target.checked })}
                  disabled={task.busy}
                />
                <span>Bake Tangent Space Normal Map</span>
              </label>
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
              onClick={() => void task.run('Revisi editor manual', task.version?.id ?? null, { kind: 'material', recipe })}
            >
              Simpan revisi editor
            </button>
          </details>
        </aside>

        <div className="procedural-canvas">
          <div className="viewport-toolbar">
            <span>{recipe.modelName}</span>
            <span className="small-tag">{recipe.resolution}px · {recipe.layers.length} Layer</span>
          </div>

          <div
            className="preview-canvas-content mesh-canvas"
            style={{
              minHeight: '340px',
              background: '#0d0c0f',
              borderRadius: '10px',
              padding: '16px',
            }}
          >
            <div className="pbr-maps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
              <div className="pbr-map-item">
                <span className="pbr-map-label" style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Color (Albedo)</span>
                <div className="pbr-map-preview" style={{ height: '110px', borderRadius: '6px', background: gradient(visible.map((layer) => layer.color)) }} />
              </div>
              <div className="pbr-map-item">
                <span className="pbr-map-label" style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Roughness Map</span>
                <div className="pbr-map-preview" style={{ height: '110px', borderRadius: '6px', background: gradient(channel('roughness')) }} />
              </div>
              <div className="pbr-map-item">
                <span className="pbr-map-label" style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Metalness Map</span>
                <div className="pbr-map-preview" style={{ height: '110px', borderRadius: '6px', background: gradient(channel('metalness')) }} />
              </div>
              <div className="pbr-map-item">
                <span className="pbr-map-label" style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Normal Map</span>
                <div className="pbr-map-preview" style={{ height: '110px', borderRadius: '6px', background: 'linear-gradient(135deg, #8080ff, #8888ee, #7f7fff)' }} />
              </div>
            </div>
            <p className="preview-caption" style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              Ilustrasi layer SurfaceAppearance: Color, Roughness, Metalness, dan Tangent Normal.
            </p>
          </div>

          <div className="generator-actions" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => downloadJson(recipe, `${recipe.modelName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_pbr.json`)}
            >
              <Icon name="download" /> Ekspor JSON
            </button>
            <button
              type="button"
              className="button secondary-button"
              disabled
              aria-describedby="material-apply-reason"
            >
              Terapkan ke Studio
            </button>
          </div>
          <p id="material-apply-reason" className="generator-caption">
            Penerapan belum tersedia: SurfaceAppearance/MaterialVariant memerlukan upload tekstur dan izin tulis Studio.
          </p>
        </div>
      </div>
    </section>
  );
}
