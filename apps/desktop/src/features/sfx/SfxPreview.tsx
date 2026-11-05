import { Icon } from '../../design-system/Icon';
import type { AudioAnalysis } from '../../engines/sfx/dsp';

export function SfxPreview({
  waveformSvg,
  analysis,
  durationMs,
  name,
  isPlaying,
  onPlayToggle,
  volume,
  onVolumeChange,
}: {
  waveformSvg: string;
  analysis: AudioAnalysis | null;
  durationMs: number;
  name: string;
  isPlaying: boolean;
  onPlayToggle: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
}) {
  return (
    <section
      aria-label="Pratinjau Efek Suara"
      className="gfx-preview canvas-panel sfx-preview"
      id="sfx-preview"
    >
      <header className="canvas-heading">
        <div className="canvas-label">
          <Icon name="wave" />
          <h2>Bentuk Gelombang & Analisis Audio</h2>
          <span className="canvas-format">DSP SYNTH</span>
        </div>
        <div className="sfx-header-controls">
          <span className="canvas-dimensions">
            {durationMs} <span>ms</span> · 44.1 <span>kHz</span>
          </span>
        </div>
      </header>

      <div className="canvas-stage sfx-canvas-stage">
        {waveformSvg ? (
          <div className="sfx-preview-stage-content">
            <div className="sfx-waveform-card">
              <div
                className="sfx-waveform-display"
                dangerouslySetInnerHTML={{ __html: waveformSvg }}
              />
              <div className="sfx-transport-bar">
                <button
                  type="button"
                  className={`button secondary-button sfx-play-btn${isPlaying ? ' is-playing' : ''}`}
                  onClick={onPlayToggle}
                  aria-label={isPlaying ? 'Hentikan pemutaran suara' : 'Putar efek suara'}
                >
                  <Icon name={isPlaying ? 'close' : 'spark'} />
                  {isPlaying ? 'Hentikan' : 'Putar Audio'}
                </button>
                <div className="sfx-playback-badge">
                  <span className={`live-dot${isPlaying ? ' is-pulsing' : ''}`} />
                  <span>{isPlaying ? 'Memutar audio…' : 'Audio siap'}</span>
                </div>
              </div>
              <label className="sfx-preview-volume">
                <span>Volume pratinjau {Math.round(volume * 100)}%</span>
                <input type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={(event) => onVolumeChange(Number(event.target.value))} />
              </label>
            </div>

            {analysis && (
              <div className="sfx-analysis-grid" role="region" aria-label="Metrik analisis audio">
                <div className="sfx-metric-item">
                  <span className="metric-label">Puncak (Peak)</span>
                  <strong className={`metric-val${analysis.hasClipping ? ' is-clipping' : ''}`}>
                    {analysis.peakDbfs} dBFS
                  </strong>
                </div>
                <div className="sfx-metric-item">
                  <span className="metric-label">Daya Rata-rata</span>
                  <strong className="metric-val">{analysis.rms} RMS</strong>
                </div>
                <div className="sfx-metric-item">
                  <span className="metric-label">Zero Crossings</span>
                  <strong className="metric-val">{analysis.zeroCrossings}</strong>
                </div>
                <div className="sfx-metric-item">
                  <span className="metric-label">Format WAV</span>
                  <strong className="metric-val">16-bit PCM</strong>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="empty-art" aria-hidden="true">
              <div className="empty-sheet sheet-back" />
              <div className="empty-sheet sheet-front">
                <Icon name="wave" />
                <span />
                <span />
              </div>
              <span className="empty-spark">
                <Icon name="spark" />
              </span>
            </div>
            <span className="empty-kicker">GENERATOR EFEK SUARA DSP</span>
            <h3>
              Sintesis audio game
              <br />
              tajam, jernih, dan ringan.
            </h3>
            <p>
              Pilih preset koin, laser, lompat, atau ledakan,
              <br className="wide-break" /> lalu atur frekuensi dan ADSR untuk mendapatkan karakter suara yang pas.
            </p>
            <span className="shortcut-hint">Sintesis di toolbar · ⌘ / Ctrl + Enter</span>
          </div>
        )}
      </div>

      <footer className="canvas-footer">
        <span>
          <span className="live-dot" /> {waveformSvg ? `Audio "${name}" tervalidasi` : 'Menunggu sintesis'}
        </span>
        <span>WAV lokal · Upload dan moderasi Roblox terpisah</span>
      </footer>
    </section>
  );
}
