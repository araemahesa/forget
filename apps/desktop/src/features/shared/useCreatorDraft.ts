import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { loadCreatorDraft, saveCreatorDraft, type CreatorDraft, type CreatorKind } from '../../services/creatorWorkspace';

export function useCreatorDraft<T>(kind: CreatorKind, restore: (draft: CreatorDraft<T>) => Promise<void>) {
  const native = isTauri();
  const [ready, setReady] = useState(!native);
  const [notice, setNotice] = useState(native ? 'Memuat draf lokal...' : 'Autosave memerlukan aplikasi desktop.');
  const [error, setError] = useState(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const initialized = useRef(false);
  const revision = useRef(0);
  const pending = useRef<{ spec: T; baselineVersionId: string | null } | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const generation = useRef(0);
  const failed = useRef(false);

  async function flush(): Promise<void> {
    clearTimeout(timer.current);
    if (!native) return;
    if (running.current) { await running.current; return flush(); }
    // Nothing to save must never block window close or backup, even after a failed load.
    if (!pending.current) return;
    if (!initialized.current) throw new Error(`Draf ${kind} belum berhasil dimuat.`);
    const operation = (async () => {
      while (pending.current) {
        const snapshot = pending.current;
        const saved = await saveCreatorDraft({ kind, ...snapshot, revision: revision.current, engineVersion: 1, updatedAt: '' });
        revision.current = saved.revision;
        if (pending.current === snapshot) pending.current = null;
      }
      failed.current = false;
      if (mounted.current) { setNotice('Draf tersimpan otomatis di perangkat.'); setError(false); }
    })();
    running.current = operation;
    try { await operation; }
    catch (failure) {
      failed.current = true;
      if (mounted.current) { setNotice(`Draf belum tersimpan: ${failure instanceof Error ? failure.message : 'Penyimpanan gagal.'}`); setError(true); }
      throw failure;
    } finally { running.current = null; }
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;

  async function load() {
    if (!native) return;
    const current = ++generation.current;
    try {
      const draft = await loadCreatorDraft<T>(kind);
      if (!mounted.current || current !== generation.current) return;
      if (draft) {
        if (draft.engineVersion !== 1) throw new Error('Versi engine draf tidak didukung.');
        await restoreRef.current(draft);
        revision.current = draft.revision;
      }
      if (!mounted.current || current !== generation.current) return;
      initialized.current = true;
      setReady(true); setError(false);
      setNotice(draft ? 'Draf lokal dipulihkan.' : 'Autosave aktif setelah perubahan.');
    } catch (failure) {
      if (mounted.current && current === generation.current) {
        setNotice(`Pemulihan draf gagal: ${failure instanceof Error ? failure.message : 'Penyimpanan gagal.'}`);
        setError(true);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    const onFlush = (event: Event) => (event as CustomEvent<Promise<void>[]>).detail.push(flushRef.current());
    const onHidden = () => { if (document.visibilityState === 'hidden' && initialized.current) void flushRef.current().catch(() => {}); };
    window.addEventListener('forgekit:flush-draft', onFlush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      mounted.current = false; generation.current++;
      window.removeEventListener('forgekit:flush-draft', onFlush);
      document.removeEventListener('visibilitychange', onHidden);
      clearTimeout(timer.current);
      if (initialized.current) void flushRef.current().catch(() => {});
    };
  }, [kind]);

  function queue(spec: T, baselineVersionId: string | null) {
    if (!native || !initialized.current) return;
    pending.current = { spec, baselineVersionId };
    if (failed.current) return;
    setNotice('Perubahan draf belum tersimpan...');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 350);
  }
  return { ready, notice, error, queue, retry: () => initialized.current ? flushRef.current() : load() };
}
