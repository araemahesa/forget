import { useEffect, useRef, useState } from 'react';
import { refreshUsageAfterTask } from '../../services/providerUsage';
import { useProviders } from '../../services/providerState';
import { TaskAttempts } from './TaskAttempts';
import { call } from '../../services/tauri';
import { taskError } from './taskError';

type Task = { kind?: string; threadId?: string; id: string; status: string; error?: string; candidate?: string; provider?: { profileId: string; modelId: string; adapterId: string }; toolResults?: unknown[]; recovery?: { canFinalize: boolean; canVerify?: boolean; canResumeEdit?: boolean; hasEffects: boolean; hasUnknownEffects: boolean; verification: string; turnsUsed: number; turnsLimit: number; callsUsed: number; callsLimit: number; reason?: string } };
export function TaskRecovery({ taskId, disabled = false, showCandidate = false, compact = false, onRecovered, onBusyChange }: { taskId: string | null; disabled?: boolean; showCandidate?: boolean; compact?: boolean; onRecovered: (result: unknown) => void | Promise<void>; onBusyChange?: (busy: boolean) => void }) {
  const { profiles } = useProviders();
  const alive = useRef(true);
  const currentId = useRef(taskId); currentId.current = taskId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (busy) return;
    let alive = true; setTask(null); setError('');
    if (taskId && !disabled) void call<Task>('get_creative_task', { id: taskId }).then((value) => { if (alive) setTask(value); }).catch(() => {});
    return () => { alive = false; };
  }, [taskId, disabled, busy]);
  if (!task || disabled || (['completed', 'preview_ready'].includes(task.status) && !task.recovery?.hasEffects && !(showCandidate && task.candidate))) return null;
  const recovery = task.recovery;
  if (compact && !recovery?.canFinalize && !recovery?.canResumeEdit && !recovery?.canVerify && !busy) return null;
  const completed = ['completed', 'preview_ready'].includes(task.status);
  async function finalize(mode: 'finalize' | 'verify' | 'stop_play' = 'finalize') {
    if (!taskId || busy) return;
    const id = taskId; const selected = profiles.find((p) => p.id === task?.provider?.profileId);
    setBusy(true); onBusyChange?.(true); setError('');
    try { const result = await call<unknown>('resume_ai_task', { id, mode }); if (alive.current && currentId.current === id) await onRecovered(result); }
    catch (e) { if (alive.current && currentId.current === id) setError(e instanceof Error ? e.message : 'Finalisasi belum selesai.'); }
    finally { if (selected) void refreshUsageAfterTask(profiles, id, selected); if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  }
  async function cancel() {
    const id = taskId;
    try { await call(task?.kind === 'chat' ? 'cancel_chat_stream' : 'cancel_creative', task?.kind === 'chat' ? { threadId: task.threadId } : { id }); }
    catch (e) { if (alive.current && currentId.current === id) setError(`Pembatalan gagal: ${e instanceof Error ? e.message : 'finalisasi belum dapat dihentikan.'}`); }
  }
  return <section className="task-recovery" aria-label="Pemulihan tugas" aria-busy={busy}>
    {busy && <TaskAttempts taskId={taskId} running visual={compact} />}
    <p>{compact ? 'Lanjutkan dari proses tersimpan.' : <><strong>Status sistem · </strong>{recovery?.hasUnknownEffects ? 'Sebagian operasi belum dapat dipastikan. Penulisan tidak diulang; periksa hasil di Studio.' : recovery?.hasEffects ? 'Operasi map telah tercatat. Receipt belum membuktikan hasil map terverifikasi; tinjau hasil dan jawaban provider.' : completed ? 'Kandidat provider telah diperiksa dan tersimpan untuk ditinjau.' : task.status === 'failed' && task.error ? `Tugas gagal: ${taskError(task.error)}` : 'Tugas belum selesai. Hasil sebelumnya dipertahankan.'}</>}</p>
    {!compact && task.provider && <small>{task.provider.adapterId} · {task.provider.modelId}</small>}
    {recovery?.canFinalize && <button className="button secondary-button" type="button" disabled={busy} onClick={() => void finalize()}>{busy ? 'Menyelesaikan…' : 'Selesaikan jawaban'}</button>}
    {recovery?.canResumeEdit && <><p>Menunggu mode Edit</p><button className="button secondary-button" type="button" disabled={busy} onClick={() => void finalize('stop_play')}>Hentikan Play dan lanjutkan</button></>}
    {recovery?.canVerify && <button className="button secondary-button" type="button" disabled={busy} onClick={() => void finalize('verify')}>Periksa hasil tanpa mengulang write</button>}
    {busy && <button className="button secondary-button" type="button" onClick={() => void cancel()}>Batalkan finalisasi</button>}
    {completed && <details><summary>Tinjau kandidat dan rincian</summary>
      <p>{task.error}</p>
      {recovery && <p>{recovery.turnsUsed}/{recovery.turnsLimit} putaran · {recovery.callsUsed}/{recovery.callsLimit} operasi · pemeriksaan: {recovery.verification} · {recovery.reason}</p>}
      {!!task.toolResults?.length && <pre>{JSON.stringify(task.toolResults, null, 2)}</pre>}
      {task.candidate && <pre>{task.candidate}</pre>}
    </details>}
    {error && <p role="alert">{taskError(error)}</p>}
  </section>;
}
