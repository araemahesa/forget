import { useEffect, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { listTaskAttempts, type AttemptSummary } from '../../services/ai';
import { call } from '../../services/tauri';
import { useProviders } from '../../services/providerState';

export type TaskStage =
  | 'preparing'
  | 'context'
  | 'creating'
  | 'checking'
  | 'refining'
  | 'saving'
  | 'completed'
  | 'failed';

const stageLabels: Record<string, { label: string; description: string }> = {
  queued: { label: 'Menyiapkan', description: 'Memeriksa skills dan panduan tugas' },
  planning: { label: 'Menyiapkan', description: 'Menyiapkan perencana dan alat kerja' },
  reading_context: { label: 'Membaca konteks', description: 'Membaca hierarki map dan selection aktif' },
  streaming: { label: 'Membuat', description: 'Provider menyusun konten kreatif' },
  creating: { label: 'Membuat', description: 'Engine ForgeKit menghasilkan artefak' },
  validating: { label: 'Memeriksa', description: 'Memverifikasi struktur dan validasi domain' },
  tool_running: { label: 'Menyempurnakan', description: 'Menjalankan inspeksi atau penyesuaian map' },
  refining: { label: 'Menyempurnakan', description: 'Menyesuaikan detail sesuai parameter' },
  preview_ready: { label: 'Menyimpan', description: 'Menyimpan pratinjau dan riwayat versi' },
  saving: { label: 'Menyimpan', description: 'Menyimpan artefak final ke penyimpanan lokal' },
  completed: { label: 'Selesai', description: 'Hasil terverifikasi dan siap digunakan' },
};

type ProgressPayload = {
  status?: string;
  error?: string;
  events?: { sequence: number; stage: string; createdAt: string }[];
  toolResults?: { callId: string; name: string; status?: string; readOnly?: boolean; studioId?: string; error?: string }[];
};

export function TaskProgressCard({
  taskId,
  running,
  stopping = false,
  customStage,
  error,
  notice,
  onRetry,
  onStop,
}: {
  taskId: string | null;
  running: boolean;
  stopping?: boolean;
  customStage?: string;
  error?: string | null;
  notice?: string | null;
  onRetry?: () => void;
  onStop?: () => void;
}) {
  const [data, setData] = useState<{ attempts: AttemptSummary[]; progress: ProgressPayload | null } | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const { profiles } = useProviders();

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled || !taskId) return;
      const [attemptsRes, taskRes] = await Promise.allSettled([
        listTaskAttempts(taskId),
        call<ProgressPayload>('get_creative_task', { id: taskId }),
      ]);
      if (!cancelled) {
        setData({
          attempts: attemptsRes.status === 'fulfilled' && Array.isArray(attemptsRes.value) ? attemptsRes.value : [],
          progress: taskRes.status === 'fulfilled' ? taskRes.value : null,
        });
      }
      if (!cancelled && running) {
        timer = setTimeout(() => void poll(), 750);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taskId, running]);

  if (!running && !error && !notice && !data?.progress?.events?.length) {
    return null;
  }

  const rawStatus = customStage ?? data?.progress?.status ?? (running ? 'planning' : 'completed');
  const stageInfo = stageLabels[rawStatus] ?? { label: rawStatus, description: 'Memproses permintaan' };
  const effectiveError = error ?? data?.progress?.error;
  const isPlayModeBlock = effectiveError && /mode Edit/i.test(effectiveError);

  return (
    <div className={`task-progress-card${running ? ' is-running' : ''}${effectiveError ? ' is-error' : ''}`} role="region" aria-label="Progres tugas" aria-live="polite">
      <div className="task-progress-main">
        <div className="task-progress-status-row">
          <span className={`task-progress-indicator${running ? ' is-active' : ''}`} aria-hidden="true" />
          <div className="task-progress-text">
            <strong className="task-progress-title">
              {stopping ? 'Menghentikan…' : isPlayModeBlock ? 'Menunggu mode Edit' : running ? stageInfo.label : effectiveError ? 'Kendala eksekusi' : 'Selesai'}
            </strong>
            <span className="task-progress-desc">
              {stopping
                ? 'Menunggu thread berhenti dengan aman'
                : isPlayModeBlock
                  ? 'Beralih ke mode Edit di Roblox Studio untuk melanjutkan perubahan'
                  : running
                    ? stageInfo.description
                    : effectiveError
                      ? 'Terjadi kendala pada eksekusi tugas'
                      : notice ?? 'Karya tersimpan'}
            </span>
          </div>
          <div className="task-progress-actions">
            {running && onStop && (
              <button
                type="button"
                className="button secondary-button task-btn-sm"
                aria-label="Hentikan tugas"
                disabled={stopping}
                onClick={onStop}
              >
                <Icon name="close" />
                {stopping ? 'Menghentikan…' : 'Hentikan'}
              </button>
            )}
            {!running && onRetry && (
              <button type="button" className="button secondary-button task-btn-sm" onClick={onRetry}>
                <Icon name="refresh" />
                {isPlayModeBlock ? 'Hentikan Play dan lanjutkan' : 'Ulangi tugas'}
              </button>
            )}
            {(!!data?.attempts.length || !!data?.progress?.events?.length) && (
              <button
                type="button"
                className="theme-button task-btn-sm"
                title="Diagnostik teknis"
                aria-expanded={diagnosticsOpen}
                onClick={() => setDiagnosticsOpen(!diagnosticsOpen)}
              >
                <Icon name="terminal" />
              </button>
            )}
          </div>
        </div>
      </div>

      {diagnosticsOpen && (
        <div className="task-diagnostics-panel" role="region" aria-label="Diagnostik teknis">
          <div className="task-diagnostics-header">
            <span>Diagnostik task {taskId ? `· ${taskId.slice(0, 8)}` : ''}</span>
            <button type="button" className="theme-button" onClick={() => setDiagnosticsOpen(false)} aria-label="Tutup diagnostik">
              <Icon name="close" />
            </button>
          </div>
          {!!data?.progress?.events?.length && (
            <ol className="task-diag-timeline">
              {data.progress.events.map((evt) => (
                <li key={evt.sequence}>
                  <span>{stageLabels[evt.stage]?.label ?? evt.stage}</span>
                  <time>{new Date(Number(evt.createdAt)).toLocaleTimeString('id-ID')}</time>
                </li>
              ))}
            </ol>
          )}
          {!!data?.progress?.toolResults?.length && (
            <ul className="task-diag-tools">
              {data.progress.toolResults.map((tool) => (
                <li key={tool.callId}>
                  <code>{tool.name.replace('forgekit_studio_', '')}</code>
                  <span>{tool.readOnly ? 'hanya baca' : 'ubah map'} · {tool.status ?? 'selesai'}</span>
                  {tool.error && <p className="status-error">{tool.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {!!data?.attempts?.length && (
            <ul className="task-diag-attempts">
              {data.attempts.map((att) => {
                const prof = profiles.find((p) => p.id === att.profileId);
                return (
                  <li key={att.id}>
                    <span>{prof?.name ?? att.profileId} ({att.modelId})</span>
                    <span>{att.status}</span>
                    {att.error && <p className="status-error">{att.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
