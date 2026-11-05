import { useEffect, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { listGfxTasks, type GfxTaskSummary } from '../../services/tauri';
import { creatorLabels, listWorkTasks, type LibraryKind, type WorkTask, type WorkStatus } from '../../services/creatorWorkspace';
import { cancelCreatorTask } from '../../services/creatorTasks';

export type SessionActivity = { message: string; tone: string; time: number };
const states: Record<WorkStatus, string> = {
  queued: 'Mengantre', running: 'Berjalan', cancel_requested: 'Pembatalan diminta', succeeded: 'Selesai',
  failed: 'Gagal', cancelled: 'Dibatalkan', interrupted: 'Terputus',
};
const stages: Record<string, string> = { queued: 'Antrean', validating: 'Validasi input', rendering: 'Render', rasterizing: 'Render PNG', saving: 'Simpan versi', version_saved: 'Versi tersimpan', exporting: 'Ekspor', opening: 'Periksa versi', complete: 'Selesai', stopped: 'Permintaan berhenti' };
const actions = { render: 'Render', save: 'Simpan versi', export: 'Ekspor', open: 'Buka versi' };
const active = (status: string) => ['queued', 'running', 'cancel_requested'].includes(status);

type Row = { id: string; kind: LibraryKind; title: string; status: WorkStatus; error: string | null; updatedAt: string; outputVersionId: string | null; task?: WorkTask };
function legacy(task: GfxTaskSummary): Row { return { ...task, kind: 'gfx' }; }
function modern(task: WorkTask): Row {
  return { id: task.id, kind: task.kind, title: `${actions[task.action]}: ${task.input.name ?? creatorLabels[task.kind]}`, status: task.status,
    error: task.error, updatedAt: task.updatedAt, outputVersionId: typeof task.receipt?.versionId === 'string' ? task.receipt.versionId : null, task };
}

export function ActivityPage({ activities, onOpen }: {
  activities: SessionActivity[];
  onOpen: (id: string, kind?: LibraryKind) => void;
}) {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState('all');
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.allSettled([listGfxTasks(), listWorkTasks()]).then(([gfx, creators]) => {
      if (disposed) return;
      const rows = [...(gfx.status === 'fulfilled' ? gfx.value.map(legacy) : []), ...(creators.status === 'fulfilled' ? creators.value.map(modern) : [])];
      setTasks(rows.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)));
      const failures = [gfx, creators].filter((result) => result.status === 'rejected');
      setError(failures.map((result) => result.status === 'rejected' && result.reason instanceof Error ? result.reason.message : 'Sebagian riwayat gagal dimuat.').join(' '));
      if (rows.some((task) => active(task.status))) timer = setTimeout(() => setRevision((value) => value + 1), 1000);
    }).finally(() => { if (!disposed) setLoading(false); });
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('forgekit:tasks-changed', refresh);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('forgekit:tasks-changed', refresh); };
  }, [revision, activities]);

  async function cancel(id: string) {
    setCancelling(id);
    try { await cancelCreatorTask(id); setRevision((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Permintaan pembatalan gagal.'); }
    finally { setCancelling(null); }
  }
  const visible = tasks.filter((task) => filter === 'all' || (filter === 'active' ? active(task.status) : filter === 'attention' ? ['failed', 'interrupted'].includes(task.status) : !active(task.status)));
  return <section className="catalog-page">
    <header className="catalog-heading"><p className="eyebrow">ACTIVITY</p><h1>Ikuti proses kreatifmu.</h1><p>Tahap, checkpoint, dan hasil pekerjaan yang tersimpan di perangkat ini.</p></header>
    <div className="catalog-filter-row"><h2>Riwayat tugas</h2><div role="group" aria-label="Filter tugas" className="category-filters">{[['all', 'Semua'], ['active', 'Aktif'], ['attention', 'Perlu perhatian'], ['finished', 'Berakhir']].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><button type="button" className="button secondary-button" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button></div>
    <p className="inline-notice">100 tugas kreator dan 100 tugas GFX terbaru. Tugas terputus tidak diulang otomatis; periksa receipt sebelum mengulangi operasi.</p>
    {error && <p className="inline-notice status-error" role="alert">{error} Gunakan Muat ulang untuk mencoba kembali.</p>}
    {loading ? <p role="status">Membuka riwayat...</p> : visible.length ? <div className="activity-list" aria-label="Tugas tersimpan">{visible.map((task) => {
      const attention = task.status === 'failed' || task.status === 'interrupted';
      const tone = attention ? 'error' : task.status === 'succeeded' ? 'success' : 'neutral';
      return <article className="activity-task" key={task.id}><div className="activity-row">
        <span className={`activity-icon ${tone}`}><Icon name={attention ? 'alert' : tone === 'success' ? 'check' : 'clock'} /></span>
        <div><strong>{task.title}</strong><span>{states[task.status]} · {creatorLabels[task.kind]}{task.task ? ` · ${stages[task.task.stage] ?? task.task.stage}` : ' Creator'}</span>{task.error && <p className="task-error">{task.error}</p>}</div>
        {task.outputVersionId && <button type="button" className="button secondary-button" aria-label={`Buka hasil ${task.title}`} onClick={() => onOpen(task.outputVersionId!, task.kind)}>Buka hasil</button>}
        {task.task && active(task.status) && <button className="button secondary-button" type="button" disabled={task.status === 'cancel_requested' || cancelling === task.id} onClick={() => void cancel(task.id)}>Batalkan</button>}
        <time dateTime={new Date(Number(task.updatedAt)).toISOString()}>{new Date(Number(task.updatedAt)).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</time>
      </div>{task.task && <details className="task-details"><summary>Tahap dan receipt</summary><ol>{task.task.events.map((event) => <li key={event.sequence}><span>{stages[event.stage] ?? event.stage}</span><span>{states[event.status]}</span>{event.receipt && <pre>{JSON.stringify(event.receipt, null, 2)}</pre>}</li>)}</ol><details><summary>Input tersimpan · engine {task.task.engineVersion}</summary><pre>{JSON.stringify(task.task.input, null, 2)}</pre></details>{task.status === 'interrupted' && <p>Proses tidak dilanjutkan otomatis. Receipt versi tetap menunjukkan hasil yang sudah tersimpan.</p>}</details>}</article>;
    })}</div> : error ? null : <div className="empty-page"><div className="empty-glyph"><Icon name="activity" /></div><h2>Belum ada tugas pada filter ini.</h2><p>Render atau simpan versi dari kreator untuk memulai riwayat.</p><a className="button primary-button" href="#create">Buka kreator <Icon name="arrow" /></a></div>}
    {activities.length > 0 && <><h2 className="activity-session-heading">Aktivitas sesi ini</h2><div className="activity-list">{activities.map((item, index) => <div className="activity-row" key={`${item.time}-${index}`}><span className={`activity-icon ${item.tone}`}><Icon name={item.tone === 'error' ? 'alert' : item.tone === 'success' ? 'check' : 'clock'} /></span><div><strong>{item.message}</strong><span>Workspace · sesi ini</span></div><time>{new Date(item.time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></>}
  </section>;
}
