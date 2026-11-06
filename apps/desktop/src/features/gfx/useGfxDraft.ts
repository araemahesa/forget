import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import type { GfxSpec } from '@forgekit/contracts';
import { finishAppExit, loadGfxDraft, saveGfxDraft, type GfxDraft } from '../../services/tauri';

type Snapshot = { spec: GfxSpec; baselineVersionId: string | null };
const reason = (error: unknown) => error instanceof Error ? error.message : 'Penyimpanan draf gagal.';

export async function flushPendingDraft() {
  const waiters: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent('forgekit:flush-draft', { detail: waiters }));
  await Promise.all(waiters);
}

export function useGfxDraft(restore: (draft: GfxDraft) => Promise<void>) {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('Memuat draf lokal...');
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const pending = useRef<Snapshot | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);
  const mounted = useRef(false);
  const initialized = useRef(false);
  const loadSequence = useRef(0);

  async function flush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) {
      await running.current;
      return flush();
    }
    // Nothing to save must never block window close or exit, even after a failed load.
    if (!pending.current) return;
    if (!initialized.current) throw new Error('Draf lokal belum berhasil dimuat.');
    const operation = (async () => {
      while (pending.current) {
        const snapshot = pending.current;
        const saved = await saveGfxDraft(snapshot.spec, snapshot.baselineVersionId, revision.current);
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
      if (mounted.current) { setNotice(`Draf belum tersimpan: ${reason(failure)}`); setError(true); }
      throw failure;
    } finally { running.current = null; }
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;

  async function load() {
    const sequence = ++loadSequence.current;
    try {
      const draft = await loadGfxDraft();
      if (!mounted.current || sequence !== loadSequence.current) return;
      if (draft) {
        revision.current = draft.revision;
        await restoreRef.current(draft);
      }
      if (!mounted.current || sequence !== loadSequence.current) return;
      initialized.current = true;
      setReady(true);
      setNotice(draft ? 'Draf lokal dipulihkan.' : 'Draf disimpan otomatis setelah perubahan.');
      setError(false);
    } catch (failure) {
      if (!mounted.current || sequence !== loadSequence.current) return;
      setNotice(`Pemulihan draf gagal: ${reason(failure)}`);
      setError(true);
      // Browser preview remains editable, without claiming native persistence.
      if (!isTauri()) setReady(true);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    const onFlush = (event: Event) => {
      (event as CustomEvent<Promise<void>[]>).detail.push(flushRef.current());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && initialized.current) void flushRef.current().catch(() => {});
    };
    window.addEventListener('forgekit:flush-draft', onFlush);
    document.addEventListener('visibilitychange', onVisibility);
    let unlisten: (() => void) | undefined;
    let stopQuit: (() => void) | undefined;
    // Per-effect flag: under StrictMode the shared mounted ref is true again before the first registration resolves.
    let disposed = false;
    if (isTauri()) {
      void listen('forgekit:exit-requested', async () => {
        try { await flushPendingDraft(); await finishAppExit(); }
        catch (failure) {
          if (mounted.current) { setNotice(`Aplikasi tetap terbuka: ${reason(failure)}`); setError(true); }
        }
      }).then((stop) => { if (disposed) stop(); else stopQuit = stop; }).catch((failure: unknown) => {
        if (mounted.current) { setNotice(`Pengaman keluar gagal: ${reason(failure)}`); setError(true); }
      });
      void getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();
        try { await flushPendingDraft(); await getCurrentWindow().destroy(); }
        catch (failure) {
          if (mounted.current) { setNotice(`Jendela tetap terbuka: ${reason(failure)}`); setError(true); }
        }
      }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((failure: unknown) => {
        if (mounted.current) { setNotice(`Pengaman tutup gagal: ${reason(failure)}`); setError(true); }
      });
    }
    return () => {
      disposed = true;
      mounted.current = false;
      loadSequence.current++;
      window.removeEventListener('forgekit:flush-draft', onFlush);
      document.removeEventListener('visibilitychange', onVisibility);
      unlisten?.();
      stopQuit?.();
      if (timer.current) clearTimeout(timer.current);
      if (initialized.current) void flushRef.current().catch(() => {});
    };
  }, []);

  function queue(spec: GfxSpec, baselineVersionId: string | null) {
    pending.current = { spec, baselineVersionId };
    if (failed.current || !initialized.current) return;
    setNotice('Perubahan draf belum tersimpan...');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 350);
  }

  return { ready, notice, error, queue, retry: () => initialized.current ? flushRef.current() : load() };
}
