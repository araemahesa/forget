import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { LightingRecipe } from '@forgekit/contracts';
import { validateLightingRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: LightingRecipe = {
  name: 'GoldenHour_Cinematic',
  timeOfDay: '17:45:00',
  brightness: 2.4,
  ambientColor: '#4a3b32',
  outdoorAmbientColor: '#8c684a',
  colorShift_Top: '#ffdfba',
  colorShift_Bottom: '#222233',
  shadowSoftness: 0.35,
  atmosphereDensity: 0.35,
  atmosphereHaze: 0.25,
  bloomIntensity: 0.5,
};

export function LightingPage() {
  const [recipe, setRecipe] = useState<LightingRecipe>(initialRecipe);
  const [applied, setApplied] = useState(false);

  const errors = validateLightingRecipe(recipe);

  const handleApply = () => {
    if (errors.length > 0) return;
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="sun" />
          <h2>Pencahayaan & Atmosfer</h2>
        </div>
        <p className="section-desc">Atur tata cahaya Roblox Lighting, Atmosphere, Bloom, dan ColorCorrection.</p>

        <div className="form-group">
          <label htmlFor="light-name">Nama Preset Lighting</label>
          <input
            id="light-name"
            className="text-input"
            value={recipe.name}
            onChange={(e) => setRecipe({ ...recipe, name: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="light-time">Waktu Dalam Game (TimeOfDay)</label>
          <Dropdown
            id="light-time"
            className="select-input"
            value={recipe.timeOfDay}
            onChange={(e) => setRecipe({ ...recipe, timeOfDay: e.target.value })}
          >
            <option value="06:30:00">Subuh / Fajar (06:30)</option>
            <option value="12:00:00">Siang Terik (12:00)</option>
            <option value="17:45:00">Golden Hour / Senja (17:45)</option>
            <option value="23:00:00">Malam Berbintang (23:00)</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="light-bright">Kecerahan (Brightness)</label>
            <span className="slider-val">{recipe.brightness}</span>
          </div>
          <input
            id="light-bright"
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={recipe.brightness}
            onChange={(e) => setRecipe({ ...recipe, brightness: Number(e.target.value) })}
          />
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="light-atmos">Densitas Atmosfer (Kabut)</label>
            <span className="slider-val">{Math.round(recipe.atmosphereDensity * 100)}%</span>
          </div>
          <input
            id="light-atmos"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={recipe.atmosphereDensity}
            onChange={(e) => setRecipe({ ...recipe, atmosphereDensity: Number(e.target.value) })}
          />
        </div>

        {errors.length > 0 && (
          <div className="alert alert-error">
            <Icon name="alert" />
            <span>{errors[0].message}</span>
          </div>
        )}

        <button
          className="button primary-button btn-full"
          disabled={errors.length > 0}
          onClick={handleApply}
          type="button"
        >
          <Icon name="check" />
          <span>{applied ? 'Diterapkan ke Studio!' : 'Terapkan Properti Lighting'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Simulasi Atmosfer Waktu ({recipe.timeOfDay})</span>
            <span className="small-tag">PBR SunRay & Sky</span>
          </div>
          <div className="preview-canvas-content mesh-canvas lighting-canvas">
            <svg viewBox="0 0 400 240" className="mesh-preview-svg">
              <defs>
                <linearGradient id="skyAtmosphere" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ff7e5f" />
                  <stop offset="60%" stopColor="#feb47b" />
                  <stop offset="100%" stopColor="#ffeccc" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="400" height="200" fill="url(#skyAtmosphere)" />
              {/* Sun disk */}
              <circle cx="280" cy="110" r="32" fill="#fffbe8" opacity="0.95" />
              <circle cx="280" cy="110" r="54" fill="#ffea9f" opacity="0.3" />
              {/* Ground horizon */}
              <rect x="0" y="180" width="400" height="60" fill="#2d3748" />
              <text x="200" y="225" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                Simulasi pencahayaan: TimeOfDay = {recipe.timeOfDay}, Brightness = {recipe.brightness}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
