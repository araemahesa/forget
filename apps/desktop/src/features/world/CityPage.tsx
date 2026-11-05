import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { CityDistrict, CityRecipe } from '@forgekit/contracts';
import { validateCityRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: CityRecipe = {
  name: 'Metropolis_CyberCity',
  gridSize: [8, 8],
  blockSize: 160,
  roadWidth: 28,
  density: 'high',
  districts: ['Downtown', 'Commercial', 'Residential'],
  seed: 404,
};

export function CityPage() {
  const [recipe, setRecipe] = useState<CityRecipe>(initialRecipe);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const errors = validateCityRecipe(recipe);

  const handleGenerate = () => {
    if (errors.length > 0) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 550);
  };

  const allDistricts: CityDistrict[] = ['Downtown', 'Commercial', 'Residential', 'Industrial', 'Park'];

  const toggleDistrict = (d: CityDistrict) => {
    const exists = recipe.districts.includes(d);
    setRecipe({
      ...recipe,
      districts: exists ? recipe.districts.filter((x) => x !== d) : [...recipe.districts, d],
    });
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="building" />
          <h2>Pembangun Kota (City Builder)</h2>
        </div>
        <p className="section-desc">Bangun jaringan jalan prosedural, zonasi distrik, dan footprint gedung perkotaan.</p>

        <div className="form-group">
          <label htmlFor="city-name">Nama Kota</label>
          <input
            id="city-name"
            className="text-input"
            value={recipe.name}
            onChange={(e) => setRecipe({ ...recipe, name: e.target.value })}
          />
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="city-block-size">Ukuran Blok (Stud)</label>
            <span className="slider-val">{recipe.blockSize} Studs</span>
          </div>
          <input
            id="city-block-size"
            type="range"
            min={60}
            max={300}
            step={10}
            value={recipe.blockSize}
            onChange={(e) => setRecipe({ ...recipe, blockSize: Number(e.target.value) })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="city-density">Densitas Gedung</label>
          <Dropdown
            id="city-density"
            className="select-input"
            value={recipe.density}
            onChange={(e) => setRecipe({ ...recipe, density: e.target.value as CityRecipe['density'] })}
          >
            <option value="low">Rendah (Pedesaan/Suburban)</option>
            <option value="medium">Sedang (Kota Kecil)</option>
            <option value="high">Tinggi (Pencakar Langit Metropolis)</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <label>Zonasi Distrik</label>
          <div className="tag-toggle-group">
            {allDistricts.map((district) => {
              const active = recipe.districts.includes(district);
              return (
                <button
                  key={district}
                  type="button"
                  className={`tag-toggle ${active ? 'active' : ''}`}
                  onClick={() => toggleDistrict(district)}
                >
                  {district}
                </button>
              );
            })}
          </div>
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
          <span>{generating ? 'Menata Grid Jalan & Gedung...' : 'Generate Tata Kota'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Peta Master Grid Kota ({recipe.gridSize[0]}×{recipe.gridSize[1]} Blok)</span>
            <span className="small-tag">{generated ? 'Struktur Siap' : 'Siap'}</span>
          </div>
          <div className="preview-canvas-content mesh-canvas">
            <svg viewBox="0 0 400 250" className="mesh-preview-svg">
              {/* City grid layout */}
              <rect x="50" y="30" width="80" height="80" rx="4" fill="#2d3748" stroke="var(--border)" strokeWidth="1.5" />
              <rect x="160" y="30" width="80" height="80" rx="4" fill="#1a365d" stroke="var(--accent)" strokeWidth="1.5" />
              <rect x="270" y="30" width="80" height="80" rx="4" fill="#22543d" stroke="var(--border)" strokeWidth="1.5" />

              <rect x="50" y="140" width="80" height="80" rx="4" fill="#1a365d" stroke="var(--accent)" strokeWidth="1.5" />
              <rect x="160" y="140" width="80" height="80" rx="4" fill="#2d3748" stroke="var(--border)" strokeWidth="1.5" />
              <rect x="270" y="140" width="80" height="80" rx="4" fill="#22543d" stroke="var(--border)" strokeWidth="1.5" />

              {/* Road markings */}
              <line x1="20" y1="125" x2="380" y2="125" stroke="#718096" strokeWidth="6" />
              <line x1="20" y1="125" x2="380" y2="125" stroke="#f6e05e" strokeWidth="1" strokeDasharray="6 6" />

              <line x1="145" y1="10" x2="145" y2="240" stroke="#718096" strokeWidth="6" />
              <line x1="255" y1="10" x2="255" y2="240" stroke="#718096" strokeWidth="6" />

              <text x="200" y="240" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                {generated ? `Tata kota ${recipe.name} dengan ${recipe.districts.length} zona distrik siap di-generate.` : 'Pratinjau zonasi jalan dan persimpangan'}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
