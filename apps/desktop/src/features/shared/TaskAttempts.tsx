import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { validateTaskActivity, type TaskActivity } from '@forgekit/contracts';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { listTaskAttempts, type AttemptSummary } from '../../services/ai';
import { call } from '../../services/tauri';
import { useProviders } from '../../services/providerState';

const statuses: Record<string, string> = {
  started: 'Berjalan', succeeded: 'Selesai', failed: 'Gagal', rate_limited: 'Batas sementara',
  cancelled: 'Dibatalkan', interrupted: 'Terputus', queued: 'Prompt diterima',
  planning: 'Menyiapkan skills dan rancangan', reading_context: 'Membaca konteks map',
  streaming: 'Provider menyusun dan mengerjakan hasil', tool_running: 'Menjalankan tool pada map tujuan',
  validating: 'Memeriksa format dan struktur hasil', preview_ready: 'Artefak tersimpan', completed: 'Selesai', tool_error: 'Tool melaporkan kesalahan', unknown: 'Hasil belum terverifikasi', running: 'Berjalan',
};
export function taskStage(stage?: string): string {
  switch (stage) {
    case 'queued': case 'planning': return 'Menyiapkan';
    case 'reading_context': return 'Membaca konteks';
    case 'streaming': case 'tool_running': case 'running': case 'started': return 'Membuat';
    case 'validating': return 'Memeriksa';
    case 'repairing': return 'Menyempurnakan';
    case 'saving': return 'Menyimpan';
    case 'failed': case 'tool_error': case 'request_timeout': case 'task_deadline': return 'Perlu diperbaiki';
    case 'interrupted': return 'Terputus';
    case 'cancelled': return 'Dibatalkan';
    case 'needs_action': return 'Perlu tindakan';
    case 'unknown': return 'Hasil belum terverifikasi';
    case 'completed': case 'preview_ready': return 'Selesai';
    default: return 'Menunggu status';
  }
}
type Progress = { error?: string; recovery?: { deadlineMs?: number }; activity?: TaskActivity; status?: string; events?: { sequence: number; stage: string; createdAt: string }[]; toolResults?: { callId: string; name: string; status?: string; readOnly?: boolean; studioId?: string; error?: string }[] };
export function TaskAttempts({ taskId, running, visual = false }: { taskId: string | null; running: boolean; visual?: boolean }) {
  const [history, setHistory] = useState<{ taskId: string; rows: AttemptSummary[]; progress: Progress | null } | null>(null);
  const { profiles } = useProviders();
  const [activity, setActivity] = useState<TaskActivity | null>(null);
  const activeTask = useRef(taskId);
  activeTask.current = taskId;
  const observed = useRef<TaskActivity | null>(null);
  function receive(value: unknown) {
    if (!validateTaskActivity(value) || value.taskId !== activeTask.current) return;
    if (observed.current?.taskId === value.taskId && observed.current.revision >= value.revision) return;
    observed.current = value;
    setActivity(value);
  }
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<unknown>('forgekit:task-event', ({ payload }) => { if (!disposed) receive(payload); })
      .then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => { /* Durable polling remains available. */ });
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => {
    if (!taskId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const [attempts, task] = await Promise.allSettled([listTaskAttempts(taskId!), call<Progress>('get_creative_task', { id: taskId })]);
      if (!stopped && task.status === 'fulfilled') receive(task.value?.activity);
      if (!stopped) setHistory({ taskId: taskId!, rows: attempts.status === 'fulfilled' && Array.isArray(attempts.value) ? attempts.value : [], progress: task.status === 'fulfilled' ? task.value : null });
      if (!stopped && running) timer = setTimeout(() => void refresh(), 600);
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [taskId, running]);
  if (!taskId) return null;
  const record = history?.taskId === taskId ? history : null;
  const attempts = record?.rows ?? [];
  const progress = record?.progress;
  if (!running && !attempts.length && !progress?.events?.length && activity?.taskId !== taskId) return null;
  const name = (attempt: AttemptSummary) => profiles.find((profile) => profile.id === attempt.profileId)?.name ?? 'Koneksi tersimpan';
  const hasFallback = attempts.length > 1 && (attempts[0].profileId !== attempts[attempts.length - 1].profileId || attempts[0].modelId !== attempts[attempts.length - 1].modelId);

  const current = activity?.taskId === taskId ? activity : null;
  const stage = current?.type === 'progress' || current?.type === 'candidate' ? current.stage : current?.type === 'final' ? 'completed' : current?.type === 'needs_action' ? 'needs_action' : current?.type === 'error' ? current.category : progress?.events?.at(-1)?.stage ?? progress?.status;
  const active = running && current?.type !== 'final' && current?.type !== 'error' && current?.type !== 'needs_action';
  if (visual) {
    const events = (progress?.events ?? []).filter((event, index, all) => index === 0 || event.stage !== all[index - 1].stage).slice(-6);
    return <section className="model-process" aria-label="Proses pembuatan Model 3D" aria-busy={active}>
      <header><Icon name={active ? 'activity' : stage === 'completed' || stage === 'preview_ready' ? 'check' : 'alert'} /><strong>Proses</strong><span role="status" aria-live="polite">{taskStage(stage)}</span></header>
      {!!events.length && <ol className="model-process-steps">{events.map((event, index) => <li key={event.sequence} data-current={index === events.length - 1} data-error={event.stage === 'failed' || event.stage === 'tool_error'}>
        <span className="model-process-marker"><Icon name={event.stage === 'failed' ? 'alert' : event.stage === 'completed' || event.stage === 'preview_ready' ? 'check' : event.stage === 'validating' ? 'inspect' : event.stage === 'tool_running' ? 'tools' : 'spark'} /></span>
        <span>{statuses[event.stage] === undefined ? taskStage(event.stage) : ({ queued: 'Prompt diterima', planning: 'Menyiapkan model', streaming: 'Menyusun geometri', tool_running: 'Membangun hasil', validating: 'Memeriksa hasil', preview_ready: 'Model tersimpan', completed: 'Selesai', failed: 'Proses terhenti' } as Record<string, string>)[event.stage] ?? statuses[event.stage]}</span>
        <time>{new Date(Number(event.createdAt)).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
      </li>)}</ol>}
      {!!progress?.toolResults?.length && <ul className="model-process-tools">{progress.toolResults.slice(-4).map(tool => <li key={tool.callId}><Icon name={tool.readOnly ? 'inspect' : 'tools'} /><span>{tool.name.replace(/^forgekit_(studio_)?/, '').replaceAll('_', ' ')}</span><small>{tool.status ? statuses[tool.status] ?? tool.status : 'Tercatat'}</small></li>)}</ul>}
      {active && stage === 'streaming' && <p role="status">Provider sedang menyusun geometri. Model detail dapat memerlukan beberapa menit; gunakan Stop untuk membatalkan.{attempts.at(-1)?.startedAt && ` Menunggu ${Math.max(0, Math.floor((Date.now() - Number(attempts.at(-1)!.startedAt)) / 1000))} detik.`}</p>}
      {!active && progress?.error && <p role="alert">{progress.error}</p>}
      {hasFallback && <p role="status">Beralih ke {name(attempts.at(-1)!)} pada provider yang sama.</p>}
      {!!attempts.length && <div className="model-process-provider"><Icon name="link" /><span>{name(attempts.at(-1)!)}<small>{attempts.at(-1)!.modelId}</small></span><span>{statuses[attempts.at(-1)!.status] ?? 'Menunggu'}</span></div>}
    </section>;
  }
  return <div className="task-activity">
    {running && <div className="task-active-stage" role="status" aria-live="polite"><span className={`process-indicator${active ? ' is-running' : ''}`} />{current?.type === 'needs_action' || current?.type === 'error' ? current.message : taskStage(stage)}</div>}
    <details className="prompt-process">
    <summary><span className={`process-indicator${active ? ' is-running' : ''}`} /><span>Rincian proses</span><Icon name="chevron" /></summary>
    <div className="prompt-process-content">
      <p className="generator-caption">Skills ForgeKit → provider terpilih → tools yang tersedia → pemeriksaan hasil.</p>
      {hasFallback && <div className="process-fallback-banner" role="status">
        <strong>Pengalihan Fallback:</strong> Dimulai dengan {name(attempts[0])} ({attempts[0].modelId}); selesai dengan {name(attempts[attempts.length - 1])} ({attempts[attempts.length - 1].modelId}).
      </div>}
      {!!progress?.events?.length && <ol className="process-timeline">{progress.events.map((event) => <li key={event.sequence}><span>{statuses[event.stage] ?? event.stage}</span><time>{new Date(Number(event.createdAt)).toLocaleTimeString('id-ID')}</time></li>)}</ol>}
      {!!progress?.toolResults?.length && <ul className="process-tools">{progress.toolResults.map((tool) => <li key={tool.callId}><strong>{tool.name.replace('forgekit_studio_', '')}</strong><span>{tool.readOnly ? 'Baca' : 'Ubah'}{tool.status ? ` · ${statuses[tool.status] ?? tool.status}` : ''}</span>{tool.error && <p>{tool.error}</p>}</li>)}</ul>}
      {!!attempts.length && <ol className="process-connections">{attempts.map((attempt) => <li key={attempt.id}>{name(attempt)} · {attempt.modelId} · {statuses[attempt.status] ?? attempt.status}{attempt.error && <p>{attempt.error}</p>}</li>)}</ol>}
    </div>
  </details></div>;
}
