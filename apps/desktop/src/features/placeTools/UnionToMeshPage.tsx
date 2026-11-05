import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { UnionToMeshRecipe } from '@forgekit/contracts';
import { validateUnionToMeshRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: UnionToMeshRecipe = {
  unionName: 'CastleArch_CSGUnion',
  exportFormat: 'obj',
  weldLooseParts: true,
  smoothAngle: 60,
};

export function UnionToMeshPage() {
  const [recipe, setRecipe] = useState<UnionToMeshRecipe>(initialRecipe);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);

  const errors = validateUnionToMeshRecipe(recipe);

  const handleConvert = () => {
    if (errors.length > 0) return;
    setConverting(true);
    setTimeout(() => {
      setConverting(false);
      setConverted(true);
    }, 450);
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="layers" />
          <h2>Konversi Union ke Mesh</h2>
        </div>
        <p className="section-desc">Ubah CSG Union berat menjadi MeshPart ringan untuk mengurangi draw call dan lag physics.</p>

        <div className="form-group">
          <label htmlFor="union-name">Nama Union Target</label>
          <input
            id="union-name"
            className="text-input"
            value={recipe.unionName}
            onChange={(e) => setRecipe({ ...recipe, unionName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="export-format">Format Output</label>
          <Dropdown
            id="export-format"
            className="select-input"
            value={recipe.exportFormat}
            onChange={(e) => setRecipe({ ...recipe, exportFormat: e.target.value as 'obj' | 'rbxmesh' })}
          >
            <option value="obj">Wavefront OBJ (.obj)</option>
            <option value="rbxmesh">Roblox Binary Mesh (.rbxmesh)</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="smooth-angle">Sudut Smoothing Normal</label>
            <span className="slider-val">{recipe.smoothAngle}°</span>
          </div>
          <input
            id="smooth-angle"
            type="range"
            min={0}
            max={180}
            step={5}
            value={recipe.smoothAngle}
            onChange={(e) => setRecipe({ ...recipe, smoothAngle: Number(e.target.value) })}
          />
        </div>

        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.weldLooseParts}
              onChange={(e) => setRecipe({ ...recipe, weldLooseParts: e.target.checked })}
            />
            <span>Satukan Vertex Terpisah (Merge Close Vertices)</span>
          </label>
        </div>

        {errors.length > 0 && (
          <div className="alert alert-error">
            <Icon name="alert" />
            <span>{errors[0].message}</span>
          </div>
        )}

        <button
          className="button primary-button btn-full"
          disabled={converting || errors.length > 0}
          onClick={handleConvert}
          type="button"
        >
          <Icon name="spark" />
          <span>{converting ? 'Mengekstrak Geometri...' : 'Konversi ke Mesh'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Visualisasi Hasil Konversi CSG</span>
            <span className="small-tag">{converted ? 'Mesh Siap' : 'Menunggu'}</span>
          </div>
          <div className="preview-canvas-content mesh-canvas">
            <svg viewBox="0 0 400 240" className="mesh-preview-svg">
              <path d="M 120 180 L 120 90 A 80 80 0 0 1 280 90 L 280 180 Z" fill="none" stroke="var(--accent)" strokeWidth="2" />
              <path d="M 150 180 L 150 105 A 50 50 0 0 1 250 105 L 250 180 Z" fill="var(--surface-raised)" stroke="var(--border-control)" strokeWidth="1.5" />
              <text x="200" y="215" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                {converted ? `${recipe.unionName}.${recipe.exportFormat} berhasil dibuat (1 MeshPart, 0 Sub-CSG)` : 'Lengkungan CSG akan dikonversi menjadi topologi mesh tunggal'}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
