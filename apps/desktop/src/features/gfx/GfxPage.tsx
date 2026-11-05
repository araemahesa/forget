import { EditorAiPromptBar } from '../shared/EditorAiPromptBar';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GfxSpec, GfxVersion, ValidationIssue } from '@forgekit/contracts';
import { hasBlockingGfxErrors } from '@forgekit/contracts';
import { isEditorRoute } from '../../app/featureRegistry';
import { Button } from '../../design-system/Button';
import { Icon } from '../../design-system/Icon';
import { Status } from '../../design-system/Status';
import { renderGfxSvg } from '../../engines/gfx/render';
import { svgToPng } from '../../engines/gfx/png';
import {
  cancelGfxTask, createGfxTask, exportGfxArtifact, getWorkspaceInfo,
  listGfxVersions, loadGfxVersion, saveGfxVersion, type WorkspaceInfo,
} from '../../services/tauri';
import { GfxForm } from './GfxForm';
import { GfxPreview } from './GfxPreview';
import { useGfxDraft } from './useGfxDraft';

const initialSpec: GfxSpec = {
  schemaVersion: 1,
  title: 'ForgeKit',
  subtitle: 'Berkreasi dengan jelas',
  background: '#101216',
  accent: '#FF0033',
  layout: 'centered',
  width: 1200,
  height: 800,
};

function sameSpec(left: GfxSpec, right: GfxSpec) {
  return (Object.keys(initialSpec) as (keyof GfxSpec)[]).every((key) => left[key] === right[key]);
}

async function verifyRenderedVersion(version: GfxVersion, svg: string): Promise<void> {
  if (!version.artifact) throw new Error('Versi tidak memiliki artefak SVG.');
  const bytes = new TextEncoder().encode(svg);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== version.artifact.sha256 || bytes.length !== version.artifact.byteLength) {
    throw new Error('Integritas SVG gagal: hash hasil render berbeda dari artefak tersimpan. Draf dipertahankan.');
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Operasi gagal.';
}

export function GfxPage() {
  const [spec, setSpec] = useState<GfxSpec>(initialSpec);
  const [baseline, setBaseline] = useState<GfxSpec>(initialSpec);
  const dirty = !sameSpec(spec, baseline);
  const [svg, setSvg] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const [status, setStatus] = useState('Draf belum dirender.');
  const [statusTone, setStatusTone] = useState<'neutral' | 'error' | 'success'>('neutral');
  const [baselineVersion, setBaselineVersion] = useState<GfxVersion | null>(null);
  const savedVersion = dirty ? null : baselineVersion;
  const [versions, setVersions] = useState<GfxVersion[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'controls' | 'preview'>('controls');
  const busyRef = useRef(false);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const pendingOpen = useRef<string | null>(null);
  const activeTask = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const draft = useGfxDraft(async (stored) => {
    setSpec(stored.spec);
    if (stored.baselineVersionId) {
      try {
        const version = await loadGfxVersion(stored.baselineVersionId);
        await verifyRenderedVersion(version, renderGfxSvg(version.spec).svg);
        setBaseline(version.spec);
        setBaselineVersion(version);
      } catch (error) {
        setStatus(`Draf dipulihkan; versi acuan gagal diperiksa: ${message(error)}`);
        setStatusTone('error');
      }
    }
  });
  const readyRef = useRef(false);
  readyRef.current = draft.ready;

  useEffect(() => {
    let disposed = false;
    Promise.all([listGfxVersions(), getWorkspaceInfo()]).then(([history, info]) => {
      if (!disposed) {
        setVersions((current) => [...current, ...history.filter((version) => !current.some((saved) => saved.id === version.id))].sort((a, b) => b.sequence - a.sequence));
        setWorkspace(info);
      }
    }).catch((error: unknown) => {
      if (!disposed) { setStatus(message(error)); setStatusTone('error'); }
    });
    return () => { disposed = true; };
  }, []);

  const applyAiSpec = (next: GfxSpec) => {
    if (busyRef.current || !readyRef.current) throw new Error('Editor belum siap. Kandidat tetap tersimpan untuk ditinjau.');
    const result = renderGfxSvg(next);
    if (hasBlockingGfxErrors(result.issues)) throw new Error('Hasil AI gagal validasi render. Draf sebelumnya dipertahankan.');
    setSpec(next); draft.queue(next, baselineVersion?.id ?? null);
    setSvg(result.svg); setIssues(result.issues);
    setStatus('Hasil AI dirender. Simpan versi untuk menyimpan artefak.'); setStatusTone('success');
  };

  const render = useCallback(() => {
    if (busyRef.current || !readyRef.current) return null;
    const result = renderGfxSvg(spec);
    setIssues(result.issues);
    setSvg(result.svg);
    if (hasBlockingGfxErrors(result.issues)) {
      setStatus('Perbaiki isian sebelum menyimpan atau mengekspor.');
      setStatusTone('error');
      setView('controls');
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return null;
    }
    setStatus('Pratinjau selesai.');
    setStatusTone('success');
    return result.svg;
  }, [spec]);

  const save = useCallback(async () => {
    if (busyRef.current) return;
    const rendered = render();
    if (!rendered) return;
    busyRef.current = true;
    cancelRequested.current = false;
    setBusy(true);
    setStatus('Menyimpan versi…');
    setStatusTone('neutral');
    let committed = false;
    try {
      const task = await createGfxTask(spec);
      activeTask.current = task.id;
      if (cancelRequested.current) {
        await cancelGfxTask(task.id);
        setStatus('Penyimpanan dibatalkan.');
        return;
      }
      const png = await svgToPng(rendered, spec.width, spec.height);
      if (cancelRequested.current) {
        await cancelGfxTask(task.id);
        setStatus('Penyimpanan dibatalkan.');
        return;
      }
      const version = await saveGfxVersion(task.id, rendered, png);
      committed = true;
      await verifyRenderedVersion(version, rendered);
      setBaseline(spec);
      setBaselineVersion(version);
      draft.queue(spec, version.id);
      setVersions((history) => [version, ...history.filter((saved) => saved.id !== version.id)].sort((a, b) => b.sequence - a.sequence));
      setStatus(`Versi ${version.sequence} disimpan.`);
      setStatusTone('success');
    } catch (error) {
      setStatus(message(error));
      setStatusTone('error');
    } finally {
      if (!committed && activeTask.current) {
        try { await cancelGfxTask(activeTask.current); } catch { /* Preserve the original operation error. */ }
      }
      activeTask.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }, [render, spec]);

  const cancel = useCallback(async () => {
    cancelRequested.current = true;
    if (activeTask.current) {
      try {
        const task = await cancelGfxTask(activeTask.current);
        if (task.status === 'cancelled') { setStatus('Penyimpanan dibatalkan.'); setStatusTone('neutral'); }
      } catch (error) { setStatus(message(error)); setStatusTone('error'); }
    }
  }, []);

  const open = async (id: string, discardConfirmed = false) => {
    if (busyRef.current || !readyRef.current) return;
    if (dirty && !discardConfirmed) {
      pendingOpen.current = id;
      replaceDialog.current?.showModal();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const version = await loadGfxVersion(id);
      const rendered = renderGfxSvg(version.spec);
      if (hasBlockingGfxErrors(rendered.issues)) throw new Error('Brief tersimpan tidak valid.');
      await verifyRenderedVersion(version, rendered.svg);
      setBaseline(version.spec);
      setSpec(version.spec);
      setSvg(rendered.svg);
      setIssues(rendered.issues);
      setBaselineVersion(version);
      draft.queue(version.spec, version.id);
      setStatus(`Versi ${version.sequence} dibuka.`);
      setStatusTone('success');
    } catch (error) { setStatus(message(error)); setStatusTone('error'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const exportArtifact = async (kind: 'svg' | 'png') => {
    if (!savedVersion || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const artifact = await exportGfxArtifact(savedVersion.id, kind);
      setStatus(`Diekspor ${artifact.relativePath}`);
      setStatusTone('success');
    } catch (error) { setStatus(message(error)); setStatusTone('error'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    const onOpenVersion = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (id) void open(id); };
    window.addEventListener('forgekit:open-version', onOpenVersion);
    return () => window.removeEventListener('forgekit:open-version', onOpenVersion);
  });

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('forgekit:activity', { detail: { message: status, tone: statusTone, time: Date.now() } }));
  }, [status, statusTone]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (window.location.hash && !isEditorRoute(window.location.hash, 'visual', 'gfx', 'thumbnail')) return;
      if (event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]:not(dialog)')) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      if (event.key === 'Enter') { event.preventDefault(); render(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancel, render, save]);

  return (
    <div className="gfx-page">
      <dialog aria-labelledby="replace-draft-title" aria-describedby="replace-draft-description" className="replace-dialog" ref={replaceDialog} onCancel={() => { pendingOpen.current = null; }}>
        <h2 id="replace-draft-title">Ganti draf belum tersimpan?</h2>
        <p id="replace-draft-description">Perubahan belum disimpan. Membuka versi akan membuang perubahan draf.</p>
        <div className="action-row">
          <button autoFocus className="button secondary-button" onClick={() => { pendingOpen.current = null; replaceDialog.current?.close(); }} type="button">Pertahankan draf</button>
          <button className="button primary-button" onClick={() => {
            const id = pendingOpen.current;
            pendingOpen.current = null;
            replaceDialog.current?.close();
            if (id) void open(id, true);
          }} type="button">Buang perubahan dan buka</button>
        </div>
      </dialog>
      <header className="page-header gfx-page-header">
        <div className="gfx-title-row">
          <span className="page-icon"><Icon name="image" /></span>
          <div><div className="page-title-line"><h1>GFX Creator</h1><span className="creator-type">VISUAL STUDIO</span></div>
          <p className="page-description">Ruang untuk komposisi yang punya cerita.</p></div>
        </div>
        <span className={`document-state${savedVersion ? ' is-saved' : ''}`}>
          {savedVersion ? `Versi ${savedVersion.sequence} tersimpan` : dirty ? 'Draf berubah' : 'Belum disimpan'}
        </span>
      </header>
      <EditorAiPromptBar<GfxSpec> kind="gfx" currentSpec={spec} disabled={busy || !draft.ready} onApplySpec={applyAiSpec} />
      <div aria-label="Aksi grafis" className="editor-toolbar" role="group">
        <div className="editor-section-tabs"><span className="editor-tab-active"><Icon name="panel" /> Editor</span><button type="button" onClick={() => document.getElementById('gfx-versions')?.scrollIntoView({ block: 'start' })}><Icon name="clock" /> Versi <span className="tab-count">{versions.length}</span></button></div>
        <div className="toolbar-exports">
          <button className="button primary-button" disabled={busy || !draft.ready} form="gfx-brief" type="submit"><Icon name="spark" /> Render</button>
          <Button className="secondary-button" disabled={busy || !svg || hasBlockingGfxErrors(issues)} onClick={() => void save()}><Icon name="save" /> Simpan versi</Button>
          <span className="action-separator" />
          <Button className="secondary-button" disabled={busy || !savedVersion?.artifact} onClick={() => void exportArtifact('svg')}><Icon name="download" /> Ekspor SVG</Button>
          <Button className="secondary-button" disabled={busy || !savedVersion?.artifact} onClick={() => void exportArtifact('png')}><Icon name="download" /> Ekspor PNG</Button>
          <Button className="secondary-button" disabled aria-describedby="gfx-apply-reason">Terapkan ke Studio</Button>
          {busy ? <Button className="secondary-button" onClick={() => void cancel()}>Batalkan simpan</Button> : null}
        </div>
        <span id="gfx-apply-reason" className="visually-hidden">Penerapan belum tersedia: aset visual memerlukan upload Decal/ImageLabel dan izin tulis Studio.</span>
      </div>
      <div className="editor-switch" role="group" aria-label="Tampilan editor">
        <button aria-controls="gfx-controls" aria-pressed={view === 'controls'} className="button secondary-button" onClick={() => setView('controls')} type="button">Pengaturan</button>
        <button aria-controls="gfx-preview" aria-pressed={view === 'preview'} className="button secondary-button" onClick={() => setView('preview')} type="button">Pratinjau</button>
      </div>
      <div className="gfx-workspace" data-view={view}>
        <GfxPreview height={spec.height} svg={svg} width={spec.width} />
        <section aria-label="Brief GFX" className="panel inspector" id="gfx-controls">
          <div className="panel-heading"><div><h2>Detail grafis</h2><p className="eyebrow">Sentuhanmu, di setiap detail.</p></div><Icon name="settings" /></div>
          <fieldset className="editor-fields" disabled={busy || !draft.ready}>
            <legend className="visually-hidden">Isian brief grafis</legend>
            <GfxForm issues={issues} onChange={(patch) => {
              const next = { ...spec, ...patch };
              setSpec(next);
              draft.queue(next, baselineVersion?.id ?? null);
              setSvg(''); setIssues([]); setStatusTone('neutral');
              setStatus(baselineVersion && sameSpec(next, baseline) ? 'Draf sama dengan versi tersimpan. Render untuk memperbarui pratinjau.' : 'Draf berubah. Render sebelum menyimpan.');
            }} onRender={render} spec={spec} />
          </fieldset>
          <footer className="inspector-footer"><p><Icon name="check" /> Ruang kreasi di perangkatmu</p></footer>
        </section>
      </div>
      <div className="status-bar" id="gfx-operation-status"><div className={`operation-state ${statusTone}`}><span className="live-dot" /><Status tone={statusTone}>{status}</Status></div><span className="shortcut-hint">GFX · SVG & PNG</span></div>
      <div className="draft-status" role="status">
        <Status tone={draft.error ? 'error' : 'neutral'}>{draft.notice}</Status>
        {draft.error ? <Button className="secondary-button" onClick={() => { void draft.retry().catch(() => {}); }}>Coba simpan atau muat draf lagi</Button> : null}
      </div>
      <div aria-live="polite" className="render-warnings">
        {warnings.length ? <ul aria-label="Peringatan render" className="status">
          {warnings.map((issue) => <li key={`${issue.path}-${issue.message}`}>Peringatan {issue.path}: {issue.message}</li>)}
        </ul> : null}
      </div>
      <section aria-label="Versi tersimpan" className="panel version-history" id="gfx-versions">
        <div className="history-heading">
          <div><p className="eyebrow">Ruang kerja lokal</p><h2>Versi tersimpan</h2></div>
          <span aria-label={`${versions.length} versi tersimpan`} className="history-count">{versions.length}</span>
        </div>
        {workspace ? <p className="workspace-path">Ruang kerja: {workspace.rootPath}</p> : null}
        {workspace?.orphanArtifacts.length ? <Status tone="error">Artefak tanpa referensi disimpan untuk pemeriksaan: {workspace.orphanArtifacts.join(', ')}</Status> : null}
        {versions.length ? <ul className="version-list">{versions.map((version) => <li className="version-item" key={version.id}>
          <span aria-hidden="true" className="version-icon"><Icon name="workspace" /></span>
          <div className="version-copy"><strong>{version.spec.title}</strong><span>Versi {version.sequence} · {version.spec.width} × {version.spec.height} px</span></div>
          <Button className="secondary-button" disabled={busy || !draft.ready} onClick={() => void open(version.id)}>Buka versi {version.sequence}</Button>
        </li>)}</ul> : <div className="history-empty"><Icon name="save" /><div><p>Belum ada versi tersimpan.</p><span>Render grafis, lalu simpan versi pertama. Karya tetap tersimpan di perangkat ini.</span></div></div>}
      </section>

    </div>
  );
}
