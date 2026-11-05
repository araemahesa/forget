import type { SkyboxPreset, SkyboxRecipe, ValidationIssue } from '@forgekit/contracts';
import { Select } from '../../design-system/Select';
import { TextField } from '../../design-system/TextField';
import { skyboxPresetsData } from '../../engines/skybox/render';

const presetOptions: { value: SkyboxPreset; label: string }[] = [
  { value: 'clear_day', label: 'Siang Cerah (Clear Day)' },
  { value: 'sunset', label: 'Senja Keemasan (Golden Sunset)' },
  { value: 'night_stars', label: 'Malam Berbintang (Night Stars)' },
  { value: 'overcast', label: 'Mendung Berawan (Overcast)' },
  { value: 'blood_moon', label: 'Bulan Merah (Blood Moon)' },
  { value: 'alien_nebula', label: 'Nebula Kosmik (Alien Nebula)' },
];

const resolutionOptions = [
  { value: '512', label: '512 × 512 px per sisi (Standar Roblox)' },
  { value: '1024', label: '1024 × 1024 px per sisi (Definisi Tinggi)' },
];

export function SkyboxForm({
  recipe,
  issues,
  onChange,
  onRender,
}: {
  recipe: SkyboxRecipe;
  issues: ValidationIssue[];
  onChange: (patch: Partial<SkyboxRecipe>) => void;
  onRender: () => void;
}) {
  const errorFor = (path: string) =>
    issues.find((issue) => issue.path === path && issue.severity === 'error')?.message;

  const applyPreset = (preset: SkyboxPreset) => {
    const presetData = skyboxPresetsData[preset];
    if (presetData) {
      onChange({
        ...presetData,
      });
    }
  };

  return (
    <form
      className="gfx-form skybox-form"
      id="skybox-brief"
      onSubmit={(event) => {
        event.preventDefault();
        onRender();
      }}
    >
      <fieldset className="form-section">
        <legend>Preset & Identitas</legend>
        <TextField
          label="Nama Skybox"
          error={errorFor('name')}
          value={recipe.name}
          onChange={(val) => onChange({ name: val })}
        />
        <Select
          label="Preset Suasana Langit"
          options={presetOptions}
          value={recipe.preset}
          onChange={(val) => applyPreset(val as SkyboxPreset)}
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>Waktu & Pencahayaan</legend>
        <div className="field-group">
          <label htmlFor="field-time-of-day" className="field-label">
            Waktu Dunia: {recipe.timeOfDay.toFixed(1)}:00
          </label>
          <input
            id="field-time-of-day"
            type="range"
            min="0"
            max="24"
            step="0.5"
            value={recipe.timeOfDay}
            onChange={(e) => onChange({ timeOfDay: parseFloat(e.target.value) })}
            className="slider-input"
          />
        </div>

        <div className="field-grid-2">
          <div className="field-group">
            <label htmlFor="field-sun-elevation" className="field-label">
              Elevasi Matahari: {recipe.sunElevation}°
            </label>
            <input
              id="field-sun-elevation"
              type="range"
              min="-90"
              max="90"
              step="1"
              value={recipe.sunElevation}
              onChange={(e) => onChange({ sunElevation: parseInt(e.target.value, 10) })}
              className="slider-input"
            />
          </div>
          <div className="field-group">
            <label htmlFor="field-sun-azimuth" className="field-label">
              Arah Azimuth: {recipe.sunAzimuth}°
            </label>
            <input
              id="field-sun-azimuth"
              type="range"
              min="0"
              max="360"
              step="5"
              value={recipe.sunAzimuth}
              onChange={(e) => onChange({ sunAzimuth: parseInt(e.target.value, 10) })}
              className="slider-input"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Warna Langit & Horizon</legend>
        <div className="field-grid-2">
          <div className="field-group">
            <label htmlFor="field-top-color" className="field-label">Langit Atas (Zenith)</label>
            <div className="color-field-wrap">
              <input
                id="field-top-color"
                type="color"
                value={recipe.topColor}
                onChange={(e) => onChange({ topColor: e.target.value })}
                className="color-picker"
              />
              <span className="color-hex-label">{recipe.topColor}</span>
            </div>
          </div>
          <div className="field-group">
            <label htmlFor="field-horizon-color" className="field-label">Horizon (Garis Cakrawala)</label>
            <div className="color-field-wrap">
              <input
                id="field-horizon-color"
                type="color"
                value={recipe.horizonColor}
                onChange={(e) => onChange({ horizonColor: e.target.value })}
                className="color-picker"
              />
              <span className="color-hex-label">{recipe.horizonColor}</span>
            </div>
          </div>
        </div>

        <div className="field-grid-2">
          <div className="field-group">
            <label htmlFor="field-bottom-color" className="field-label">Dasar (Nadir / Tanah)</label>
            <div className="color-field-wrap">
              <input
                id="field-bottom-color"
                type="color"
                value={recipe.bottomColor}
                onChange={(e) => onChange({ bottomColor: e.target.value })}
                className="color-picker"
              />
              <span className="color-hex-label">{recipe.bottomColor}</span>
            </div>
          </div>
          <div className="field-group">
            <label htmlFor="field-sun-color" className="field-label">Matahari / Bulan</label>
            <div className="color-field-wrap">
              <input
                id="field-sun-color"
                type="color"
                value={recipe.sunColor}
                onChange={(e) => onChange({ sunColor: e.target.value })}
                className="color-picker"
              />
              <span className="color-hex-label">{recipe.sunColor}</span>
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Atmosfer & Partikel</legend>
        <div className="field-group">
          <label htmlFor="field-stars" className="field-label">
            Kepadatan Bintang: {Math.round(recipe.starDensity * 100)}%
          </label>
          <input
            id="field-stars"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={recipe.starDensity}
            onChange={(e) => onChange({ starDensity: parseFloat(e.target.value) })}
            className="slider-input"
          />
        </div>

        <div className="field-group">
          <label htmlFor="field-clouds" className="field-label">
            Tutupan Awan: {Math.round(recipe.cloudCover * 100)}%
          </label>
          <input
            id="field-clouds"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={recipe.cloudCover}
            onChange={(e) => onChange({ cloudCover: parseFloat(e.target.value) })}
            className="slider-input"
          />
        </div>

        <div className="field-group">
          <label htmlFor="field-haze" className="field-label">
            Kabut Atmosfer: {Math.round(recipe.haze * 100)}%
          </label>
          <input
            id="field-haze"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={recipe.haze}
            onChange={(e) => onChange({ haze: parseFloat(e.target.value) })}
            className="slider-input"
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Resolusi & Seed</legend>
        <Select
          label="Resolusi Kubus"
          options={resolutionOptions}
          value={String(recipe.resolution)}
          onChange={(val) =>
            onChange({ resolution: parseInt(val, 10) as 512 | 1024 })
          }
        />
        <div className="seed-row">
          <TextField
            label="Seed Acak"
            type="number"
            value={String(recipe.seed)}
            onChange={(val) =>
              onChange({ seed: Math.max(0, parseInt(val || '0', 10)) })
            }
          />
          <button
            type="button"
            className="button secondary-button seed-shuffle-btn"
            onClick={() => onChange({ seed: Math.floor(Math.random() * 900000) + 1000 })}
            title="Acak Seed"
          >
            Acak
          </button>
        </div>
      </fieldset>
    </form>
  );
}
