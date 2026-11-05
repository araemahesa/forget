import { useCallback, useEffect, useRef, useState } from 'react';
import type { ValidationIssue } from '@forgekit/contracts';
import { isEditorRoute } from '../app/featureRegistry';
import { useCreatorDraft } from './useCreatorDraft';
import { runCreatorTask, type CreatorTaskContext } from '../services/creatorTasks';
import { Button } from '../design-system/Button';
import { Icon } from '../design-system/Icon';
import { svgToPng } from '../engines/gfx/png';
import {
  exportImageArtifact, listImageVersions, loadImageVersion, renderImageDocument, saveImageVersion,
  type ImageDocument, type ImageKind, type ImageSpecs, type ImageVersion,
} from '../services/images';

export function useImageDocument<K extends ImageKind>(kind: K, initialSpec: ImageSpecs[K], controlsId: string) {
  const [spec, setSpec] = useState(initialSpec);
  const [baseline, setBaseline] = useState(initialSpec);
  const [output, setOutput] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [status, setStatus] = useState('Draf belum dirender.');
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [versions, setVersions] = useState<ImageVersion[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [working, setBusy] = useState(false);
  const [view, setView] = useState<'controls' | 'preview'>('controls');
  const lock = useRef(false);
  const dirty = JSON.stringify(spec) !== JSON.stringify(baseline);
  const savedVersion = !dirty ? versions.find((v) => v.id === savedId) : undefined;
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<string | null>(null);
  const draft = useCreatorDraft<ImageSpecs[K]>(kind, async (stored) => {
    setSpec(stored.spec);
    if (stored.baselineVersionId) {
      try {
        const loaded = await loadImageVersion(stored.baselineVersionId);
        if (loaded.version.document.kind !== kind) throw new Error('Jenis versi acuan berbeda.');
        setBaseline(loaded.version.document.spec as ImageSpecs[K]);
        setSavedId(stored.baselineVersionId);
      } catch (error) {
        setStatus(`Draf dipulihkan; versi acuan gagal diperiksa: ${error instanceof Error ? error.message : 'Versi tidak tersedia.'}`);
        setStatusTone('error');
      }
    }
  });
  const busy = working || !draft.ready;
  const ready = useRef(draft.ready);
  ready.current = draft.ready;

  useEffect(() => {
    const onFlush = (event: Event) => {
      if (!lock.current) return;
      const message = 'Operasi gambar masih berjalan. Tunggu sebelum menutup aplikasi atau membuat backup.';
      setStatus(message); setStatusTone('neutral');
      (event as CustomEvent<Promise<void>[]>).detail.push(Promise.reject(new Error(message)));
    };
    window.addEventListener('forgekit:flush-draft', onFlush);
    return () => window.removeEventListener('forgekit:flush-draft', onFlush);
  }, []);

  useEffect(() => {
    let mounted = true;
    void listImageVersions(kind).then(
      (items) => { if (mounted) setVersions((current) => [...current, ...items.filter((v) => !current.some((c) => c.id === v.id))].sort((a, b) => b.sequence - a.sequence)); },
      (error: unknown) => { if (mounted) setHistoryError(error instanceof Error ? error.message : 'Riwayat gagal dimuat.'); },
    );
    return () => { mounted = false; };
  }, [kind]);

  const change = (patch: Partial<ImageSpecs[K]>) => {
    if (lock.current || !draft.ready) return;
    const next = { ...spec, ...patch };
    setSpec(next);
    draft.queue(next, savedId);
    setOutput({});
    setIssues([]);
    setStatus('Draf berubah. Render untuk memperbarui pratinjau.');
    setStatusTone('neutral');
  };

  const applyAiSpec = (next: ImageSpecs[K]) => {
    if (lock.current || !ready.current) throw new Error('Editor belum siap. Kandidat tetap tersimpan untuk ditinjau.');
    const result = renderImageDocument({ kind, spec: next } as ImageDocument);
    if (result.issues.some((issue) => issue.severity === 'error')) throw new Error('Hasil AI gagal validasi render. Draf sebelumnya dipertahankan.');
    setSpec(next); draft.queue(next, savedId);
    setIssues(result.issues);
    setOutput(Object.fromEntries(result.images.map((image) => [image.name, image.svg])));
    setStatus('Hasil AI dirender. Simpan versi untuk menyimpan artefak.'); setStatusTone('success');
  };

  const build = useCallback(() => {
    const result = renderImageDocument({ kind, spec } as ImageDocument);
    setIssues(result.issues);
    if (result.issues.some((issue) => issue.severity === 'error')) {
      setOutput({});
      setStatus('Perbaiki isian sebelum menyimpan atau mengekspor.');
      setStatusTone('error');
      setView('controls');
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`#${controlsId} [aria-invalid="true"]`)?.focus());
      return null;
    }
    setOutput(Object.fromEntries(result.images.map((image) => [image.name, image.svg])));
    return result.images;
  }, [kind, spec, controlsId]);

  const persist = useCallback(async (task: CreatorTaskContext) => {
    const images = build();
    if (!images) throw new Error('Perbaiki isian sebelum menyimpan atau mengekspor.');
    setStatus('Merender PNG dan menyimpan versi…');
    setStatusTone('neutral');
    // Render sequentially: at most one canvas and decoded image per document.
    await task.checkpoint('rasterizing');
    const inputs = [];
    for (const image of images) {
      const pngBytes = await svgToPng(image.svg, image.width, image.height);
      if (task.signal.aborted) throw new DOMException('Tugas dibatalkan.', 'AbortError');
      inputs.push({ name: image.name, svg: image.svg, pngBytes: Array.from(pngBytes) });
    }
    await task.checkpoint('saving');
    const version = task.id
      ? await saveImageVersion({ kind, spec } as ImageDocument, inputs, task.id)
      : await saveImageVersion({ kind, spec } as ImageDocument, inputs);
    setVersions((current) => [version, ...current.filter((v) => v.id !== version.id)].slice(0, 100));
    setSavedId(version.id);
    setBaseline(spec);
    draft.queue(spec, version.id);
    setHistoryError('');
    return version;
  }, [build, kind, spec]);

  const operate = useCallback(async (action: (task: CreatorTaskContext) => Promise<void>, taskAction?: 'render' | 'save' | 'export' | 'open') => {
    if (lock.current || !ready.current) return;
    lock.current = true;
    setBusy(true);
    const controller = new AbortController();
    try {
      if (taskAction) await runCreatorTask(kind, taskAction, spec, controller, action);
      else await action({ signal: controller.signal, checkpoint: async () => {} });
    }
    catch (error) {
      setStatus(error instanceof Error ? error.message : 'Operasi gambar gagal.');
      setStatusTone('error');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [kind, spec]);

  const save = useCallback(() => operate(async (task) => {
    const version = await persist(task);
    setStatus(`Versi ${version.sequence} disimpan.`); setStatusTone('success');
  }, 'save'), [operate, persist]);

  const render = useCallback(() => {
    if (lock.current || !ready.current) return;
    return operate(async (task) => {
      await task.checkpoint('rendering');
      if (!build()) throw new Error('Perbaiki isian sebelum menyimpan atau mengekspor.');
      setStatus('Pratinjau selesai.'); setStatusTone('success');
    }, 'render');
  }, [build, operate]);

  const openVersion = (id: string, discard = false) => {
    if (lock.current || !ready.current) return;
    if (dirty && !discard) {
      pending.current = id;
      dialog.current?.showModal();
      return;
    }
    void operate(async (task) => {
      await task.checkpoint('opening');
      const loaded = await loadImageVersion(id);
      if (loaded.version.document.kind !== kind) throw new Error('Jenis versi tidak sesuai editor.');
      const rendered = renderImageDocument(loaded.version.document);
      if (rendered.issues.some((issue) => issue.severity === 'error') ||
          rendered.images.some((image) => loaded.svgs[image.name] !== image.svg)) {
        throw new Error('Hasil versi berbeda dengan engine saat ini. Draf dipertahankan.');
      }
      const next = loaded.version.document.spec as ImageSpecs[K];
      setSpec(next); setBaseline(next); setSavedId(id);
      draft.queue(next, id);
      setOutput(loaded.svgs); setIssues(rendered.issues);
      setStatus(`Versi ${loaded.version.sequence} dibuka.`); setStatusTone('success');
    }, 'open');
  };

  const exportArtifact = (name: string, format: 'svg' | 'png') => operate(async (task) => {
    const version = savedVersion ?? await persist(task);
    if (!version) return;
    await task.checkpoint('exporting', { versionId: version.id });
    const receipt = await exportImageArtifact(version.id, name, format);
    await task.checkpoint('exporting', { versionId: version.id, ...receipt });
    setStatus(`Diekspor ke ${receipt.relativePath}`); setStatusTone('success');
  }, 'export');

  const copySvg = (name: string) => operate(async () => {
    const rendered = build();
    const image = rendered?.find((image) => image.name === name);
    if (!image) return;
    await navigator.clipboard.writeText(image.svg);
    setStatus('Kode SVG disalin ke clipboard.'); setStatusTone('success');
  });

  const openRef = useRef(openVersion);
  openRef.current = openVersion;
  useEffect(() => {
    const onOpen = (event: Event) => {
      const target = (event as CustomEvent<{ kind: string; id: string }>).detail;
      if (target.kind === kind) openRef.current(target.id);
    };
    window.addEventListener('forgekit:open-creator-version', onOpen);
    return () => window.removeEventListener('forgekit:open-creator-version', onOpen);
  }, [kind]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEditorRoute(window.location.hash, kind === 'texture' ? 'material' : 'visual', kind) || event.defaultPrevented ||
          document.querySelector('dialog[open], [aria-modal="true"]:not(dialog)') || lock.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); render(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [kind, render, save]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('forgekit:activity', { detail: { message: status, tone: statusTone, time: Date.now() } }));
  }, [status, statusTone]);

  return {
    spec, change, applyAiSpec, render, output, issues, status, statusTone, historyError, versions, savedVersion,
    busy, dirty, view, setView, save, openVersion, exportArtifact, copySvg, dialog, draft,
    discard: () => { const id = pending.current; pending.current = null; dialog.current?.close(); if (id) openVersion(id, true); },
    keep: () => { pending.current = null; dialog.current?.close(); },
  };
}

export function ImageHistory({ id, label, versions, busy, onOpen }: {
  id: string; label: string; versions: ImageVersion[]; busy: boolean; onOpen: (id: string) => void;
}) {
  if (!versions.length) return null;
  return (
    <section className="panel version-history" id={id} aria-label={`Riwayat versi ${label}`}>
      <h2>Riwayat versi {label}</h2>
      <p className="image-history-note">100 versi terbaru. SVG dan PNG tersimpan di workspace; ekspor membuat salinan.</p>
      <div className="version-list">
        {versions.map((version) => (
          <div key={version.id} className="version-item">
            <span className="image-version-icon" aria-hidden="true"><Icon name="layers" /></span>
            <div className="version-meta"><strong>Versi {version.sequence}</strong><span>{version.document.spec.name}</span></div>
            <Button className="secondary-button" disabled={busy} onClick={() => onOpen(version.id)}>Buka</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
