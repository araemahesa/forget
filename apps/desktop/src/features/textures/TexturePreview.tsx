import type { TextureMapType } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import type { TilingMode } from '../../engines/textures/render';

const mapTypeLabels: Record<TextureMapType, string> = {
  baseColor: 'Base Color',
  normal: 'Normal Map',
  roughness: 'Roughness',
  height: 'Height',
};
const mapTypes: TextureMapType[] = ['baseColor', 'normal', 'roughness', 'height'];

const tilingModes: { value: TilingMode; label: string }[] = [
  { value: '1x1', label: '1×1 (Ubin)' },
  { value: '2x2', label: '2×2 (Seam)' },
  { value: '3x3', label: '3×3 (Dinding)' },
];

export function TexturePreview({
  svg,
  resolution,
  name,
  mapType,
  tiling,
  onMapTypeChange,
  onTilingChange,
}: {
  svg: string;
  resolution: number;
  name: string;
  mapType: TextureMapType;
  tiling: TilingMode;
  onMapTypeChange: (map: TextureMapType) => void;
  onTilingChange: (tiling: TilingMode) => void;
}) {
  return (
    <section
      aria-label="Pratinjau Tekstur"
      className="gfx-preview canvas-panel texture-preview"
      id="texture-preview"
    >
      <header className="canvas-heading">
        <div className="canvas-label">
          <Icon name="layers" />
          <h2>Pratinjau Tekstur PBR</h2>
          <span className="canvas-format">PBR</span>
        </div>
        <div className="texture-header-controls">
          <div className="texture-tiling-switch" role="group" aria-label="Uji pengulangan ubin">
            {tilingModes.map((mode) => (
              <button
                type="button"
                key={mode.value}
                className={`texture-mode-btn${tiling === mode.value ? ' is-active' : ''}`}
                aria-pressed={tiling === mode.value}
                onClick={() => onTilingChange(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <span className="canvas-dimensions">
            {resolution} × {resolution} <span>px</span>
          </span>
        </div>
      </header>

      {/* Map selector tabs */}
      <div className="texture-map-bar" role="tablist" aria-label="Pilihan peta tekstur" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? mapTypes.length - 1
          : (mapTypes.indexOf(mapType) + (event.key === 'ArrowRight' ? 1 : -1) + mapTypes.length) % mapTypes.length;
        onMapTypeChange(mapTypes[index]);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
      }}>
        {mapTypes.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            id={`texture-map-${type}`}
            aria-controls="texture-map-panel"
            aria-selected={mapType === type}
            tabIndex={mapType === type ? 0 : -1}
            className={`texture-map-tab${mapType === type ? ' is-active' : ''}`}
            onClick={() => onMapTypeChange(type)}
          >
            {mapTypeLabels[type]}
          </button>
        ))}
      </div>

      <div className="canvas-stage texture-canvas-stage" id="texture-map-panel" role="tabpanel" aria-labelledby={`texture-map-${mapType}`}>
        {svg ? (
          <div className="texture-preview-stage-content">
            <div
              className={`texture-hero-frame svg-frame texture-frame-${tiling}`}
              dangerouslySetInnerHTML={{ __html: svg }}
              key={`${svg}-${mapType}-${tiling}`}
            />
            <div className="texture-meta-badge" role="status">
              <span className="seam-indicator">
                <Icon name="check" /> Periksa sambungan ubin
              </span>
              <span className="map-badge-text">
                Peta: <strong>{mapTypeLabels[mapType]}</strong> · Mode: <strong>{tiling}</strong>
              </span>
            </div>
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="empty-art" aria-hidden="true">
              <div className="empty-sheet sheet-back" />
              <div className="empty-sheet sheet-front">
                <Icon name="layers" />
                <span />
                <span />
              </div>
              <span className="empty-spark">
                <Icon name="spark" />
              </span>
            </div>
            <span className="empty-kicker">TEKSTUR PROSEDURAL PBR</span>
            <h3>
              Pola permukaan
              <br />
              untuk dunia Roblox.
            </h3>
            <p>
              Pilih pola bata, kayu, ubin, atau kisi logam,
              <br className="wide-break" /> lalu periksa sambungan seam pada mode 2×2 atau 3×3.
            </p>
            <span className="shortcut-hint">Render di toolbar · ⌘ / Ctrl + Enter</span>
          </div>
        )}
      </div>

      <footer className="canvas-footer">
        <span>
          <span className="live-dot" /> {svg ? `Tekstur "${name}" siap` : 'Menunggu render'}
        </span>
        <span>Peta ilustratif · Belum diuji di Studio</span>
      </footer>
    </section>
  );
}
