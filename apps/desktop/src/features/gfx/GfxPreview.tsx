import { Icon } from '../../design-system/Icon';

export function GfxPreview({ svg, width, height }: { svg: string; width: number; height: number }) {
  return (
    <section aria-label="Pratinjau GFX" className="gfx-preview canvas-panel" id="gfx-preview">
      <header className="canvas-heading">
        <div className="canvas-label"><Icon name="image" /><h2>Pratinjau</h2><span className="canvas-format">SVG</span></div>
        <span className="canvas-dimensions">{width} × {height} <span>px</span></span>
      </header>
      <div className="canvas-stage">
        {svg ? <div className="svg-frame" dangerouslySetInnerHTML={{ __html: svg }} key={svg} /> : <div className="canvas-empty">
          <div className="empty-art" aria-hidden="true"><div className="empty-sheet sheet-back" /><div className="empty-sheet sheet-front"><Icon name="image" /><span /><span /></div><span className="empty-spark"><Icon name="spark" /></span></div>
          <span className="empty-kicker">KANVAS MILIKMU</span>
          <h3>Ide bagus dimulai<br />dari ruang kosong.</h3>
          <p>Atur teks, warna, dan komposisi di panel<br className="wide-break" /> detail. Lalu beri bentuk pada idemu.</p>
          <span className="shortcut-hint">Render di toolbar · ⌘ / Ctrl + Enter</span>
        </div>}
      </div>
      <footer className="canvas-footer"><span><span className="live-dot" /> {svg ? 'Pratinjau siap' : 'Menunggu sentuhan pertama'}</span><span>Vektor · Resolusi fleksibel</span></footer>
    </section>
  );
}
