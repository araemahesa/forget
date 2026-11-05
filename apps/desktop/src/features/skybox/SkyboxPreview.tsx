import { useState } from 'react';
import type { CubeFace, SkyboxRecipe } from '@forgekit/contracts';
import { cubeFaceLabels, cubeFaces, validateSkyboxRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import {
  renderCubeFaceSvg,
  renderPanoramaStripSvg,
  renderSkyboxCubeNetSvg,
} from '../../engines/skybox/render';

export type SkyboxPreviewMode = 'net' | 'panorama' | 'single';

export function SkyboxPreview({
  recipe,
  onCopyScript,
}: {
  recipe: SkyboxRecipe;
  onCopyScript: () => void;
}) {
  const [viewMode, setViewMode] = useState<SkyboxPreviewMode>('net');
  const [selectedFace, setSelectedFace] = useState<CubeFace>('ft');

  const invalid = validateSkyboxRecipe(recipe).some((issue) => issue.severity === 'error');
  let previewContent = '';
  if (!invalid && viewMode === 'net') {
    previewContent = renderSkyboxCubeNetSvg(recipe, 120);
  } else if (!invalid && viewMode === 'panorama') {
    previewContent = renderPanoramaStripSvg(recipe, 640, 160);
  } else if (!invalid) {
    previewContent = renderCubeFaceSvg(recipe, selectedFace, 360);
  }

  return (
    <section
      aria-label="Pratinjau Skybox"
      className="gfx-preview canvas-panel skybox-preview"
      id="skybox-preview"
    >
      <header className="canvas-heading">
        <div className="canvas-label">
          <Icon name="sun" />
          <h2>Pratinjau Skybox & Pencahayaan</h2>
          <span className="canvas-format">{recipe.resolution}×{recipe.resolution} CUBE</span>
        </div>
        <div className="skybox-header-controls">
          <div className="skybox-view-switch" role="group" aria-label="Mode pratinjau skybox">
            <button
              type="button"
              className={`skybox-mode-btn${viewMode === 'net' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'net'}
              onClick={() => setViewMode('net')}
            >
              Jaring Kubus (6 Sisi)
            </button>
            <button
              type="button"
              className={`skybox-mode-btn${viewMode === 'panorama' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'panorama'}
              onClick={() => setViewMode('panorama')}
            >
              Panorama 360°
            </button>
            <button
              type="button"
              className={`skybox-mode-btn${viewMode === 'single' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'single'}
              onClick={() => setViewMode('single')}
            >
              Satu Sisi
            </button>
          </div>
        </div>
      </header>

      {viewMode === 'single' && (
        <div className="face-tabs" role="tablist" aria-label="Pilih sisi kubus skybox">
          {cubeFaces.map((face) => (
            <button
              key={face}
              type="button"
              role="tab"
              aria-selected={selectedFace === face}
              className={`face-tab-btn${selectedFace === face ? ' is-active' : ''}`}
              onClick={() => setSelectedFace(face)}
            >
              {face.toUpperCase()} · {cubeFaceLabels[face].split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      <div className="skybox-canvas-viewport">
        {invalid && <p role="status">Lengkapi isian yang valid untuk memperbarui pratinjau.</p>}
        <div
          className={`skybox-render-frame is-${viewMode}`}
          dangerouslySetInnerHTML={{ __html: previewContent }}
        />
      </div>

      <footer className="canvas-footer skybox-footer">
        <div className="lighting-spec-card">
          <div className="lighting-prop">
            <span className="prop-name">ClockTime</span>
            <span className="prop-val">{recipe.timeOfDay.toFixed(1)}</span>
          </div>
          <div className="lighting-prop">
            <span className="prop-name">OutdoorAmbient</span>
            <span className="prop-val-color">
              <span className="color-swatch" style={{ background: recipe.horizonColor }} />
              {recipe.horizonColor}
            </span>
          </div>
          <div className="lighting-prop">
            <span className="prop-name">ColorShift_Top</span>
            <span className="prop-val-color">
              <span className="color-swatch" style={{ background: recipe.sunColor }} />
              {recipe.sunColor}
            </span>
          </div>
          <div className="lighting-prop">
            <span className="prop-name">StarCount</span>
            <span className="prop-val">{Math.floor(recipe.starDensity * 3000)}</span>
          </div>
          <button
            type="button"
            className="button secondary-button copy-script-btn"
            onClick={onCopyScript}
            disabled={invalid}
            title="Salin Skrip Luau Roblox Lighting & Sky"
          >
            Salin Skrip Luau
          </button>
        </div>
      </footer>
    </section>
  );
}
