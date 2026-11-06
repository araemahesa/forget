import { EditorAiPromptBar } from '../shared/EditorAiPromptBar';
import { useState } from 'react';
import type { ClothingSpec } from '@forgekit/contracts';
import { Button } from '../../design-system/Button';
import { Icon } from '../../design-system/Icon';
import { Status } from '../../design-system/Status';
import { ImageHistory, useImageDocument } from '../shared/useImageDocument';
import { clothingDimensions } from '@forgekit/contracts';
import type { ClothingViewMode } from '../../engines/clothing/render';
import { ClothingForm } from './ClothingForm';
import { ClothingPreview } from './ClothingPreview';

const initialSpec: ClothingSpec = {
  schemaVersion: 1,
  name: 'Kemeja Petualang',
  kind: 'shirt',
  baseColor: '#2C3E50',
  accentColor: '#E74C3C',
  pattern: 'stripes',
  neckStyle: 'collar',
  pocket: true,
  cuffColor: '#1A252F',
  shading: true,
  templateGuide: false,
};

export function ClothingPage() {
  const editor = useImageDocument('clothing', initialSpec, 'clothing-controls');
  const { spec, issues, status, statusTone, versions, savedVersion, busy, dirty, view, setView, render, save } = editor;
  const [viewMode, setViewMode] = useState<ClothingViewMode>('template');
  const templateSvg = editor.output.template ?? '';
  const avatarSvg = editor.output.avatar ?? '';
  const { width, height } = clothingDimensions(spec.kind);
  const exportSvg = () => void editor.exportArtifact(viewMode, 'svg');
  const exportPng = () => editor.exportArtifact('template', 'png');
  const copySvg = () => void editor.copySvg(viewMode);

  return (
    <div className="gfx-page clothing-page">
      <dialog className="replace-dialog" ref={editor.dialog} aria-labelledby="clothing-replace-title">
        <h2 id="clothing-replace-title">Buang perubahan saat ini?</h2>
        <p>Isian desain pakaian yang belum disimpan akan digantikan oleh versi yang dipilih.</p>
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
            <Icon name="shirt" />
          </span>
          <div>
            <div className="page-title-line">
              <h1>Desainer Pakaian</h1>
              <span className="creator-type">ROBLOX CLOTHING STUDIO</span>
            </div>
            <p className="page-description">
              Rancang kemeja, celana, dan kaos grafis dengan template 585×559 dan grafis 512×512. Pemetaan Studio belum diuji.
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
      <EditorAiPromptBar<ClothingSpec> kind="clothing" currentSpec={spec} disabled={busy} onApplySpec={editor.applyAiSpec} />

      <div aria-label="Aksi pakaian" className="editor-toolbar" role="group">
        <div className="editor-section-tabs">
          <span className="editor-tab-active">
            <Icon name="panel" /> Editor
          </span>
          {versions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                document.getElementById('clothing-versions')?.scrollIntoView({ block: 'start' })
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
            form="clothing-brief"
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
            disabled={busy || !templateSvg}
            onClick={copySvg}
          >
            Salin SVG
          </Button>
          <Button
            className="secondary-button"
            disabled={busy || !templateSvg}
            onClick={exportSvg}
          >
            <Icon name="download" /> Ekspor SVG
          </Button>
          <Button
            className="secondary-button"
            disabled={busy || !templateSvg}
            onClick={() => void exportPng()}
          >
            <Icon name="download" /> Ekspor PNG
          </Button>
          <Button
            className="secondary-button"
            disabled
            aria-describedby="clothing-apply-reason"
          >
            Terapkan ke Studio
          </Button>
        </div>
        <span id="clothing-apply-reason" className="visually-hidden">Penerapan belum tersedia: pakaian klasik memerlukan upload Shirt/Pants template ke Roblox dan adapter Studio saat ini hanya inspeksi baca.</span>
      </div>

      <div className="editor-switch" role="group" aria-label="Tampilan editor">
        <button
          aria-controls="clothing-controls"
          aria-pressed={view === 'controls'}
          className="button secondary-button"
          onClick={() => setView('controls')}
          type="button"
        >
          Pengaturan
        </button>
        <button
          aria-controls="clothing-preview"
          aria-pressed={view === 'preview'}
          className="button secondary-button"
          onClick={() => setView('preview')}
          type="button"
        >
          Pratinjau
        </button>
      </div>

      <div className="gfx-workspace clothing-workspace" data-view={view}>
        <ClothingPreview
          avatarSvg={avatarSvg}
          height={height}
          name={spec.name}
          onViewModeChange={setViewMode}
          svg={templateSvg}
          viewMode={viewMode}
          width={width}
        />
        <section aria-label="Brief Pakaian" className="panel inspector" id="clothing-controls">
          <fieldset className="editor-fields image-fields" disabled={busy}>
            <ClothingForm
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

      <ImageHistory id="clothing-versions" label="pakaian" versions={versions} busy={busy} onOpen={editor.openVersion} />

    </div>
  );
}
