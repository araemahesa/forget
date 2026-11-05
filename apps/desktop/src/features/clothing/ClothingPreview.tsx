import { Icon } from '../../design-system/Icon';
import type { ClothingViewMode } from '../../engines/clothing/render';

export function ClothingPreview({
  svg,
  avatarSvg,
  width,
  height,
  name,
  viewMode,
  onViewModeChange,
}: {
  svg: string;
  avatarSvg: string;
  width: number;
  height: number;
  name: string;
  viewMode: ClothingViewMode;
  onViewModeChange: (mode: ClothingViewMode) => void;
}) {
  const currentSvg = viewMode === 'template' ? svg : avatarSvg;

  return (
    <section
      aria-label="Pratinjau Pakaian"
      className="gfx-preview canvas-panel clothing-preview"
      id="clothing-preview"
    >
      <header className="canvas-heading">
        <div className="canvas-label">
          <Icon name="shirt" />
          <h2>Pratinjau Desain Pakaian</h2>
          <span className="canvas-format">ROBLOX CLASSIC</span>
        </div>
        <div className="clothing-header-controls">
          <div className="clothing-view-switch" role="group" aria-label="Mode pratinjau pakaian">
            <button
              type="button"
              className={`clothing-mode-btn${viewMode === 'template' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'template'}
              onClick={() => onViewModeChange('template')}
            >
              Template 2D
            </button>
            <button
              type="button"
              className={`clothing-mode-btn${viewMode === 'avatar' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'avatar'}
              onClick={() => onViewModeChange('avatar')}
            >
              Manekin 2D/R6
            </button>
          </div>
          <span className="canvas-dimensions">
            {width} × {height} <span>px</span>
          </span>
        </div>
      </header>

      <div className="canvas-stage clothing-canvas-stage">
        {currentSvg ? (
          <div className="clothing-preview-stage-content">
            <div
              className={`clothing-hero-frame svg-frame clothing-frame-${viewMode}`}
              dangerouslySetInnerHTML={{ __html: currentSvg }}
              key={`${currentSvg.slice(0, 40)}-${viewMode}`}
            />
            <div className="clothing-meta-badge" role="status">
              <span className="template-indicator">
                <Icon name="check" /> Ukuran template ({width}×{height} px)
              </span>
              <span className="clothing-badge-text">
                Tampilan: <strong>{viewMode === 'template' ? 'Template Potongan 2D' : 'Mannequin Avatar'}</strong>
              </span>
            </div>
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="empty-art" aria-hidden="true">
              <div className="empty-sheet sheet-back" />
              <div className="empty-sheet sheet-front">
                <Icon name="shirt" />
                <span />
                <span />
              </div>
              <span className="empty-spark">
                <Icon name="spark" />
              </span>
            </div>
            <span className="empty-kicker">DESAIN PAKAIAN ROBLOX</span>
            <h3>
              Kemeja, kaos, dan celana
              <br />
              dengan template 2D.
            </h3>
            <p>
              Rancang pola bahan, kerah, saku, dan manset,
              <br className="wide-break" /> lalu lihat pratinjau langsung pada avatar atau template 2D.
            </p>
            <span className="shortcut-hint">Render di toolbar · ⌘ / Ctrl + Enter</span>
          </div>
        )}
      </div>

      <footer className="canvas-footer">
        <span>
          <span className="live-dot" /> {svg ? `Pakaian "${name}" siap` : 'Menunggu render'}
        </span>
        <span>Pemetaan belum diuji di Studio · Ekspor SVG/PNG</span>
      </footer>
    </section>
  );
}
