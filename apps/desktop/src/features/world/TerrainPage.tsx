import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { TerrainBiome, TerrainRecipe } from '@forgekit/contracts';
import { validateTerrainRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: TerrainRecipe = {
  name: 'BentangAlam_PegununganHijau',
  seed: 1337,
  sizeX: 512,
  sizeZ: 512,
  maxHeight: 140,
  waterLevel: 25,
  addCaves: true,
  biomes: ['Plains', 'Mountains'],
};

export function TerrainPage() {
  const [recipe, setRecipe] = useState<TerrainRecipe>(initialRecipe);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const errors = validateTerrainRecipe(recipe);

  const handleGenerate = () => {
    if (errors.length > 0) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 550);
  };

  const toggleBiome = (b: TerrainBiome) => {
    const exists = recipe.biomes.includes(b);
    setRecipe({
      ...recipe,
      biomes: exists ? recipe.biomes.filter((x) => x !== b) : [...recipe.biomes, b],
    });
  };

  const allBiomes: TerrainBiome[] = ['Plains', 'Mountains', 'Canyon', 'Desert', 'Arctic', 'Marsh'];

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="mountain" />
          <h2>Editor Terrain & Bioma</h2>
        </div>
        <p className="section-desc">Generate bentang alam voxel prosedural dengan bukit, sungai, dan sistem gua.</p>

        <div className="form-group">
          <label htmlFor="terrain-name">Nama Bentang Alam</label>
          <input
            id="terrain-name"
            className="text-input"
            value={recipe.name}
            onChange={(e) => setRecipe({ ...recipe, name: e.target.value })}
          />
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="terrain-size">Ukuran Peta (Voxel)</label>
            <span className="slider-val">{recipe.sizeX} × {recipe.sizeZ}</span>
          </div>
          <Dropdown
            id="terrain-size"
            className="select-input"
            value={recipe.sizeX}
            onChange={(e) => {
              const val = Number(e.target.value);
              setRecipe({ ...recipe, sizeX: val, sizeZ: val });
            }}
          >
            <option value={256}>256 × 256 (Kecil)</option>
            <option value={512}>512 × 512 (Standar)</option>
            <option value={1024}>1024 × 1024 (Besar)</option>
            <option value={2048}>2048 × 2048 (Epik)</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <label>Pilihan Bioma</label>
          <div className="tag-toggle-group">
            {allBiomes.map((biome) => {
              const active = recipe.biomes.includes(biome);
              return (
                <button
                  key={biome}
                  type="button"
                  className={`tag-toggle ${active ? 'active' : ''}`}
                  onClick={() => toggleBiome(biome)}
                >
                  {biome}
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.addCaves}
              onChange={(e) => setRecipe({ ...recipe, addCaves: e.target.checked })}
            />
            <span>Bentuk Sistem Gua Bawah Tanah (Worm Noise)</span>
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
          disabled={generating || errors.length > 0}
          onClick={handleGenerate}
          type="button"
        >
          <Icon name="spark" />
          <span>{generating ? 'Mengkalkulasi Voxel Heightmap...' : 'Generate Terrain'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Heightmap Voxel Topografi</span>
            <span className="small-tag">{generated ? 'Voxel Siap Ditulis' : 'Siap'}</span>
          </div>
          <div className="preview-canvas-content mesh-canvas">
            <svg viewBox="0 0 400 240" className="mesh-preview-svg">
              {/* Mountain silhouettes */}
              <polygon points="40,200 120,80 200,200" fill="#2d4a22" opacity="0.9" />
              <polygon points="140,200 240,50 340,200" fill="#3b5e2b" opacity="0.8" />
              <polygon points="260,200 320,110 380,200" fill="#253d1c" opacity="0.95" />
              {/* Snow caps */}
              <polygon points="220,70 240,50 260,70" fill="#ffffff" />
              <polygon points="105,95 120,80 135,95" fill="#ffffff" />
              {/* Water plane */}
              <rect x="0" y="195" width="400" height="45" fill="#2b6cb0" opacity="0.85" />
              <text x="200" y="230" textAnchor="middle" fill="#ffffff" fontSize="12">
                {generated ? `Voxel terrain ${recipe.sizeX}x${recipe.sizeZ} siap diinjeksi ke Roblox Studio Workspace.Terrain` : 'Simulasi kontur elevasi bentang alam'}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
