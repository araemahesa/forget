import { useState } from 'react';
import type { TextureSpec } from '@forgekit/contracts';
import { Button } from '../../design-system/Button';
import { Icon } from '../../design-system/Icon';
import { Status } from '../../design-system/Status';
import { ImageHistory, useImageDocument } from '../useImageDocument';
import type { TextureMapType } from '@forgekit/contracts';
import { renderTextureSvg, type TilingMode } from '../../engines/textures/render';
import { TextureForm } from './TextureForm';
import { TexturePreview } from './TexturePreview';

const initialSpec: TextureSpec = {
  schemaVersion: 1,
  name: 'Batu Bata Kastil',
  pattern: 'bricks',
  baseColor: '#7A3520',
  accentColor: '#B85333',
  roughness: 0.8,
  metalness: 0.05,
  scale: 4,
  seed: 42,
  resolution: 256,
};

export function TexturesPage() {
  const editor = useImageDocument('texture', initialSpec, 'texture-controls');
  const { spec, issues, status, statusTone, versions, savedVersion, busy, dirty, view, setView, render, save } = editor;
  const [mapType, setMapType] = useState<TextureMapType>('baseColor');
  const [tiling, setTiling] = useState<TilingMode>('1x1');
  const svg = editor.output.baseColor ? renderTextureSvg(spec, mapType, tiling).svg : '';
  const handleMapTypeChange = setMapType;
  const handleTilingChange = setTiling;
  const exportSvg = () => void editor.exportArtifact(mapType, 'svg');
  const exportPng = () => editor.exportArtifact(mapType, 'png');
  const copySvg = () => void editor.copySvg(mapType);

  return (
    <div className="gfx-page texture-page">
      <dialog className="replace-dialog" ref={editor.dialog} aria-labelledby="texture-replace-title">
        <h2 id="texture-replace-title">Buang perubahan saat ini?</h2>
        <p>Isian tekstur yang belum disimpan akan digantikan oleh versi yang dipilih.</p>
        <div className="action-row">
          <button
            className="button secondary-button"
            onClick={editor.keep}
            type="button"
          >
            Pertahankan draf
          </button>
          <button
            className="button primary-button"
            onClick={editor.discard}
            type="button"
          >
            Ganti dengan versi pilihan
          </button>
        </div>
      </dialog>

      <header className="page-header gfx-page-header">
        <div className="gfx-title-row">
          <span className="page-icon">
            <Icon name="layers" />
          </span>
          <div>
            <div className="page-title-line">
              <h1>Generator Tekstur</h1>
              <span className="creator-type">TEKSTUR PROSEDURAL</span>
            </div>
            <p className="page-description">
              Pola prosedural dengan peta base color, normal, roughness, dan height ilustratif.
            </p>
          </div>
        </div>
        <span className={`document-state${savedVersion ? ' is-saved' : ''}`}>
          {savedVersion
            ? `Versi ${savedVersion.sequence} tersimpan`
            : dirty
              ? 'Draf berubah'
              : 'Belum disimpan'}
        </span>
      </header>

      <div aria-label="Aksi tekstur" className="editor-toolbar" role="group">
        <div className="editor-section-tabs">
          <span className="editor-tab-active">
            <Icon name="panel" /> Editor
          </span>
          {versions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                document.getElementById('texture-versions')?.scrollIntoView({ block: 'start' })
              }
            >
              <Icon name="clock" /> Versi{' '}
              <span className="tab-count">{versions.length}</span>
            </button>
          )}
        </div>
        <div className="toolbar-exports">
          <button
            className="button primary-button"
            disabled={busy}
            form="texture-brief"
            type="submit"
          >
            <Icon name="spark" /> Render
          </button>
          <Button
            className="secondary-button"
            disabled={busy}
            onClick={() => void save()}
          >
            <Icon name="save" /> Simpan versi
          </Button>
          <span className="action-separator" />
          <Button
            className="secondary-button"
            disabled={busy || !svg}
            onClick={copySvg}
          >
            Salin SVG
          </Button>
          <Button
            className="secondary-button"
            disabled={busy || !svg}
            onClick={exportSvg}
          >
            <Icon name="download" /> Ekspor SVG
          </Button>
          <Button
            className="secondary-button"
            disabled={busy || !svg}
            onClick={() => void exportPng()}
          >
            <Icon name="download" /> Ekspor PNG
          </Button>
          <Button
            className="secondary-button"
            disabled
            aria-describedby="textures-apply-reason"
          >
            Terapkan ke Studio
          </Button>
        </div>
        <span id="textures-apply-reason" className="visually-hidden">Penerapan belum tersedia: tekstur memerlukan upload asset ID dan adapter Studio saat ini hanya inspeksi baca.</span>
      </div>

      <div className="editor-switch" role="group" aria-label="Tampilan editor">
        <button
          aria-controls="texture-controls"
          aria-pressed={view === 'controls'}
          className="button secondary-button"
          onClick={() => setView('controls')}
          type="button"
        >
          Pengaturan
        </button>
        <button
          aria-controls="texture-preview"
          aria-pressed={view === 'preview'}
          className="button secondary-button"
          onClick={() => setView('preview')}
          type="button"
        >
          Pratinjau
        </button>
      </div>

      <div className="gfx-workspace texture-workspace" data-view={view}>
        <TexturePreview
          mapType={mapType}
          name={spec.name}
          onMapTypeChange={handleMapTypeChange}
          onTilingChange={handleTilingChange}
          resolution={spec.resolution}
          svg={svg}
          tiling={tiling}
        />
        <section aria-label="Brief Tekstur" className="panel inspector" id="texture-controls">
          <fieldset className="editor-fields image-fields" disabled={busy}>
            <TextureForm
              issues={issues}
              onChange={editor.change}
              onRender={() => void render()}
              spec={spec}
            />
          </fieldset>
        </section>
      </div>

      {editor.historyError && <p className="image-history-error" role="alert">{editor.historyError}</p>}
      <p className="image-history-note">Ekspor menyimpan versi terbaru bila perlu. Berkas hasil berada di folder exports workspace.</p>
      <div className={`draft-notice${editor.draft.error ? ' status-error' : ''}`} role={editor.draft.error ? 'alert' : 'status'}>
        <span>{editor.draft.notice}</span>
        {editor.draft.error && <Button className="secondary-button" onClick={() => { void editor.draft.retry().catch(() => {}); }}>Coba simpan draf lagi</Button>}
      </div>
      <footer className="status-bar" role="status">
        <Status tone={statusTone}>{status}</Status>
        <span className="shortcut-hint">Render: ⌘/Ctrl+Enter · Simpan: ⌘/Ctrl+S</span>
      </footer>

      <ImageHistory id="texture-versions" label="tekstur" versions={versions} busy={busy} onOpen={editor.openVersion} />

    </div>
  );
}
