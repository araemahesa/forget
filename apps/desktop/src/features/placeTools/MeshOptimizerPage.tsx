import { useState } from 'react';
import type { MeshOptimizerRecipe } from '@forgekit/contracts';
import { validateMeshOptimizerRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: MeshOptimizerRecipe = {
  meshName: 'SwordOfValor_HighPoly',
  targetTriangles: 2500,
  decimationRatio: 0.45,
  preserveNormals: true,
  generateLOD: true,
};

export function MeshOptimizerPage() {
  const [recipe, setRecipe] = useState<MeshOptimizerRecipe>(initialRecipe);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimized, setOptimized] = useState(false);

  const errors = validateMeshOptimizerRecipe(recipe);

  const originalTriangles = Math.round(recipe.targetTriangles / recipe.decimationRatio);
  const estimatedSavedMemory = Math.round((originalTriangles - recipe.targetTriangles) * 0.048);

  const handleOptimize = () => {
    if (errors.length > 0) return;
    setIsOptimizing(true);
    setTimeout(() => {
      setIsOptimizing(false);
      setOptimized(true);
    }, 500);
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="cube" />
          <h2>Optimasi Mesh</h2>
        </div>
        <p className="section-desc">Kurangi densitas polygon dan generate level-of-detail (LOD) untuk performa 60 FPS.</p>

        <div className="form-group">
          <label htmlFor="mesh-name">Nama Mesh</label>
          <input
            id="mesh-name"
            className="text-input"
            value={recipe.meshName}
            onChange={(e) => setRecipe({ ...recipe, meshName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="target-triangles">Target Triangles</label>
          <input
            id="target-triangles"
            type="number"
            step={100}
            className="text-input"
            value={recipe.targetTriangles}
            onChange={(e) => setRecipe({ ...recipe, targetTriangles: Number(e.target.value) || 100 })}
          />
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="decimation-ratio">Rasio Desimasi</label>
            <span className="slider-val">{Math.round(recipe.decimationRatio * 100)}%</span>
          </div>
          <input
            id="decimation-ratio"
            type="range"
            min={0.05}
            max={1.0}
            step={0.05}
            value={recipe.decimationRatio}
            onChange={(e) => setRecipe({ ...recipe, decimationRatio: Number(e.target.value) })}
          />
        </div>

        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.preserveNormals}
              onChange={(e) => setRecipe({ ...recipe, preserveNormals: e.target.checked })}
            />
            <span>Pertahankan Vektor Normal Permukaan</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.generateLOD}
              onChange={(e) => setRecipe({ ...recipe, generateLOD: e.target.checked })}
            />
            <span>Buat 3 Tahap LOD (Dekat, Sedang, Jauh)</span>
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
          disabled={isOptimizing || errors.length > 0}
          onClick={handleOptimize}
          type="button"
        >
          <Icon name="spark" />
          <span>{isOptimizing ? 'Mendesimasi Mesh...' : 'Jalankan Optimasi Geometri'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Perbandingan Geometri Wireframe</span>
            <span className="small-tag">{optimized ? 'Optimasi Selesai' : 'Siap'}</span>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Triangles Asli</span>
              <span className="stat-value">{originalTriangles.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Target Triangles</span>
              <span className="stat-value">{recipe.targetTriangles.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Penghematan Memori</span>
              <span className="stat-value highlight">~{estimatedSavedMemory} KB</span>
            </div>
          </div>

          <div className="preview-canvas-content mesh-canvas">
            <svg viewBox="0 0 400 250" className="mesh-preview-svg">
              <polygon points="200,30 320,180 80,180" fill="none" stroke="var(--border-control)" strokeWidth="1.5" />
              <polygon points="200,30 200,180 80,180" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray={optimized ? "none" : "3 3"} />
              <polygon points="200,30 320,180 200,180" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray={optimized ? "none" : "3 3"} />
              <line x1="80" y1="180" x2="320" y2="180" stroke="var(--border)" strokeWidth="2" />
              <circle cx="200" cy="30" r="4" fill="var(--accent)" />
              <circle cx="80" cy="180" r="4" fill="var(--accent)" />
              <circle cx="320" cy="180" r="4" fill="var(--accent)" />
              <circle cx="200" cy="180" r="4" fill="var(--text-muted)" />
              <text x="200" y="220" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                {optimized ? `Geometri teroptimasi: ${recipe.targetTriangles} tris (LOD 0/1/2 dibuat)` : 'Pratinjau struktur simpul mesh'}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
