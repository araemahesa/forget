import { Icon } from '../../design-system/Icon';

const PREVIEW_SIZES = [64, 48, 32, 24, 16] as const;

export function IconPreview({
  svg,
  size,
  name,
}: {
  svg: string;
  size: number;
  name: string;
}) {
  return (
    <section aria-label="Pratinjau Ikon" className="gfx-preview canvas-panel icon-preview" id="icon-preview">
      <header className="canvas-heading">
        <div className="canvas-label">
          <Icon name="grid" />
          <h2>Pratinjau Ikon</h2>
          <span className="canvas-format">SVG</span>
        </div>
        <span className="canvas-dimensions">
          {size} × {size} <span>px</span>
        </span>
      </header>

      <div className="canvas-stage icon-canvas-stage">
        {svg ? (
          <div className="icon-preview-stage-content">
            <div
              className="icon-hero-frame svg-frame"
              dangerouslySetInnerHTML={{ __html: svg }}
              key={svg}
            />
            <div className="icon-multisize-bar" role="region" aria-label="Keterbacaan multi-ukuran">
              <span className="multisize-title">Uji Keterbacaan Game UI:</span>
              <div className="multisize-items">
                {PREVIEW_SIZES.map((previewSize) => (
                  <div key={previewSize} className="multisize-item">
                    <div
                      className="multisize-icon-box"
                      style={{ width: `${previewSize}px`, height: `${previewSize}px` }}
                      dangerouslySetInnerHTML={{ __html: svg }}
                    />
                    <span className="multisize-label">{previewSize}px</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="empty-art" aria-hidden="true">
              <div className="empty-sheet sheet-back" />
              <div className="empty-sheet sheet-front">
                <Icon name="grid" />
                <span />
                <span />
              </div>
              <span className="empty-spark">
                <Icon name="spark" />
              </span>
            </div>
            <span className="empty-kicker">IKON GAME ROBLOX</span>
            <h3>
              Ikon tajam, seragam,
              <br />
              dan mudah dibaca.
            </h3>
            <p>
              Pilih simbol, bentuk bingkai, warna,
              <br className="wide-break" /> dan uji keterbacaan pada berbagai ukuran UI.
            </p>
            <span className="shortcut-hint">Render di toolbar · ⌘ / Ctrl + Enter</span>
          </div>
        )}
      </div>

      <footer className="canvas-footer">
        <span>
          <span className="live-dot" /> {svg ? `Ikon "${name}" siap` : 'Menunggu render'}
        </span>
        <span>Vektor murni · Siap pakai Roblox UI</span>
      </footer>
    </section>
  );
}
