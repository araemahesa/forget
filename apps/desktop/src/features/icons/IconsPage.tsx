import { EditorAiPromptBar } from '../shared/EditorAiPromptBar';
import type { IconSpec } from '@forgekit/contracts';
import { Button } from '../../design-system/Button';
import { Icon } from '../../design-system/Icon';
import { Status } from '../../design-system/Status';
import { ImageHistory, useImageDocument } from '../useImageDocument';
import { IconForm } from './IconForm';
import { IconPreview } from './IconPreview';

const initialSpec: IconSpec = {
  schemaVersion: 1,
  name: 'Pedang Legendaris',
  glyph: 'sword',
  shape: 'circle',
  style: 'duotone',
  background: '#171417',
  primaryColor: '#FF405F',
  secondaryColor: '#FFD166',
  strokeWidth: 2,
  padding: 6,
  size: 64,
};

export function IconsPage() {
  const editor = useImageDocument('icon', initialSpec, 'icon-controls');
  const { spec, issues, status, statusTone, versions, savedVersion, busy, dirty, view, setView, render, save } = editor;
  const svg = editor.output.icon ?? '';
  const exportSvg = () => void editor.exportArtifact('icon', 'svg');
  const exportPng = () => editor.exportArtifact('icon', 'png');
  const copySvg = () => void editor.copySvg('icon');

  return (
    <div className="gfx-page icon-page">
      <dialog className="replace-dialog" ref={editor.dialog} aria-labelledby="icon-replace-title">
        <h2 id="icon-replace-title">Buang perubahan saat ini?</h2>
        <p>
          Isian ikon yang belum disimpan akan digantikan oleh versi yang dipilih.
        </p>
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
            <Icon name="grid" />
          </span>
          <div>
            <div className="page-title-line">
              <h1>Generator Ikon</h1>
              <span className="creator-type">GAME UI STUDIO</span>
            </div>
            <p className="page-description">
              Ikon game Roblox seragam, tajam, dan siap pakai untuk inventory dan action bar.
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
      <EditorAiPromptBar<IconSpec> kind="icon" currentSpec={spec} disabled={busy} onApplySpec={editor.applyAiSpec} />

      <div aria-label="Aksi ikon" className="editor-toolbar" role="group">
        <div className="editor-section-tabs">
          <span className="editor-tab-active">
            <Icon name="panel" /> Editor
          </span>
          {versions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                document.getElementById('icon-versions')?.scrollIntoView({ block: 'start' })
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
            form="icon-brief"
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
            aria-describedby="icons-apply-reason"
          >
            Terapkan ke Studio
          </Button>
        </div>
        <span id="icons-apply-reason" className="visually-hidden">Penerapan belum tersedia: ikon memerlukan upload ImageLabel/Decal dan adapter Studio saat ini hanya inspeksi baca.</span>
      </div>

      <div className="editor-switch" role="group" aria-label="Tampilan editor">
        <button
          aria-controls="icon-controls"
          aria-pressed={view === 'controls'}
          className="button secondary-button"
          onClick={() => setView('controls')}
          type="button"
        >
          Pengaturan
        </button>
        <button
          aria-controls="icon-preview"
          aria-pressed={view === 'preview'}
          className="button secondary-button"
          onClick={() => setView('preview')}
          type="button"
        >
          Pratinjau
        </button>
      </div>

      <div className="gfx-workspace icon-workspace" data-view={view}>
        <IconPreview name={spec.name} size={spec.size} svg={svg} />
        <section aria-label="Brief Ikon" className="panel inspector" id="icon-controls">
          <fieldset className="editor-fields image-fields" disabled={busy}>
            <IconForm
              issues={issues}
              onChange={editor.change}
              onRender={render}
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

      <ImageHistory id="icon-versions" label="ikon" versions={versions} busy={busy} onOpen={editor.openVersion} />

    </div>
  );
}
