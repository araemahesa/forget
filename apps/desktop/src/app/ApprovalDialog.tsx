import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { listToolApprovals, resolveToolApproval, type ToolApprovalRequest } from '../services/ai';

const keyOf = (item: Pick<ToolApprovalRequest, 'taskId' | 'callId'>) => `${item.taskId}\u0000${item.callId}`;

/** Shows every AI tool call that would change something and waits for the user's answer. */
export function ApprovalDialog() {
  const [queue, setQueue] = useState<ToolApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const current = queue[0];

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const add = (item: ToolApprovalRequest) => setQueue((items) => items.some((i) => keyOf(i) === keyOf(item)) ? items : [...items, item]);
    const remove = (item: Pick<ToolApprovalRequest, 'taskId' | 'callId'>) => setQueue((items) => items.filter((i) => keyOf(i) !== keyOf(item)));
    void Promise.all([
      listen<ToolApprovalRequest>('forgekit:approval-request', ({ payload }) => add(payload)),
      listen<{ taskId: string; callId: string }>('forgekit:approval-resolved', ({ payload }) => remove(payload)),
    ]).then((unlisten) => { if (disposed) unlisten.forEach((stop) => stop()); else stops.push(...unlisten); })
      // Requests raised before this listener existed (e.g. after a reload) are still waiting.
      .then(() => listToolApprovals()).then((items) => { if (!disposed) items.forEach(add); })
      .catch(() => { /* No native runtime: nothing can ask for approval. */ });
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);

  useEffect(() => {
    if (current && !dialog.current?.open) dialog.current?.showModal?.();
    if (!current && dialog.current?.open) dialog.current.close();
  }, [current]);

  async function answer(approved: boolean) {
    if (!current || busy) return;
    setBusy(true); setError('');
    try {
      await resolveToolApproval(current.taskId, current.callId, approved);
      setQueue((items) => items.filter((item) => keyOf(item) !== keyOf(current)));
    } catch (failure) {
      // The task already stopped waiting (cancelled or timed out): drop the stale request and
      // say so, because the change the user just answered did not run.
      setError(`Perubahan tidak dijalankan: ${failure instanceof Error ? failure.message : 'jawaban tidak terkirim.'}`);
      setQueue((items) => items.filter((item) => keyOf(item) !== keyOf(current)));
    } finally { setBusy(false); }
  }

  return <>{error && !current && <p role="alert" className="approval-toast">{error} <button type="button" className="theme-button" aria-label="Tutup pesan" onClick={() => setError('')}>×</button></p>}<dialog ref={dialog} className="command-palette approval-dialog" aria-labelledby="approval-title"
    onCancel={(event) => { event.preventDefault(); void answer(false); }}>
    {current && <>
      <header className="approval-header"><p className="eyebrow">PERSETUJUAN DIPERLUKAN</p><h2 id="approval-title">{current.title}</h2>
        <p>AI ingin menjalankan perubahan berikut. Periksa dulu; tidak ada yang dijalankan sebelum Anda mengizinkan.</p></header>
      <pre className="approval-preview" aria-label="Isi perubahan">{current.preview}</pre>
      {current.truncated && <p className="approval-note">Pratinjau dipotong; isi lengkap lebih panjang.</p>}
      {queue.length > 1 && <p className="approval-note">{queue.length - 1} permintaan lain menunggu.</p>}
      <footer className="approval-actions">
        <button className="button secondary-button" type="button" disabled={busy} onClick={() => void answer(false)}>Tolak</button>
        <button className="button primary-button" type="button" disabled={busy} onClick={() => void answer(true)}>Izinkan</button>
      </footer>
    </>}
  </dialog></>;
}
