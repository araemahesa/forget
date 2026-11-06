import { ObsidianContext } from './ObsidianContext';
import { TaskRecovery } from './TaskRecovery';
import { TaskAttempts } from './TaskAttempts';
import { useEffect, useState, useRef } from 'react';
import { Button } from '../../design-system/Button';
import { Icon } from '../../design-system/Icon';
import { Status } from '../../design-system/Status';
import { ProviderPicker } from './ProviderPicker';
import { OrcaUsagePanel } from './OrcaUsagePanel';
import { ModelControls } from './ModelControls';
import { useFeatureProviderSelection, type FeatureChoice } from '../../services/featureSelection';
import { generateEditorRecipe, type EditorKind } from '../../services/editorAi';
import { refreshUsageAfterTask } from '../../services/providerUsage';
import { call } from '../../services/tauri';
import { safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from '../../services/safeStorage';

const parentKey = (taskId: string) => `forgekit:editor-parent:${taskId}`;
/** Parent snapshots are only needed while their task can still be auto-applied; drop ones no editor tracks. */
function pruneParentSnapshots() {
  const tracked = new Set(safeKeys('forgekit:editor-task:').map(safeGetItem));
  for (const key of safeKeys('forgekit:editor-parent:')) if (!tracked.has(key.slice('forgekit:editor-parent:'.length))) safeRemoveItem(key);
}

export type EditorAiPromptBarProps<T> = {
  kind: EditorKind;
  onApplySpec: (spec: T, attribution: string, signal: AbortSignal) => void | Promise<void>;
  currentSpec?: T;
  placeholder?: string;
  disabled?: boolean;
};

export function EditorAiPromptBar<T>({
  kind,
  onApplySpec,
  currentSpec,
  placeholder = 'Jelaskan yang ingin dibuat…',
  disabled = false,
}: EditorAiPromptBarProps<T>) {
  const selection = useFeatureProviderSelection(kind);
  const [usageOpen, setUsageOpen] = useState(false);
  const [prompt, setPrompt] = useState(() => safeGetItem(`forgekit:editor-prompt:${kind}`) ?? '');
  const [recoveryId, setRecoveryId] = useState<string | null>(() => safeGetItem(`forgekit:editor-task:${kind}`));
  const current = useRef(currentSpec); current.current = currentSpec;
  const apply = useRef(onApplySpec); apply.current = onApplySpec;
  const applying = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; pruneParentSnapshots(); return () => { alive.current = false; applying.current?.abort(); }; }, []);
  useEffect(() => { safeSetItem(`forgekit:editor-prompt:${kind}`, prompt); }, [kind, prompt]);
  const [generating, setBusy] = useState(false);
  const [checking, setChecking] = useState(!!recoveryId);
  const [recovering, setRecovering] = useState(false);
  const busy = generating || recovering || checking;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeTaskId = useRef<string | null>(null);

  const applyResult = async (spec: T, attribution: string) => {
    if (applying.current) throw new Error('Pratinjau masih diproses.');
    const controller = new AbortController();
    applying.current = controller;
    try {
      await apply.current(spec, attribution, controller.signal);
      if (controller.signal.aborted) throw new Error('Pembuatan pratinjau dibatalkan. Kandidat tetap tersimpan.');
    } finally { if (applying.current === controller) applying.current = null; }
  };

  useEffect(() => {
    if (!recoveryId || activeTaskId.current) { setChecking(false); return; }
    let disposed = false;
    let restored = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = recoveryId;
    async function poll() {
      try {
        const task = await call<{ id: string; status: string; candidate?: string }>('get_creative_task', { id });
        if (disposed || task.id !== id) return;
        if (['queued', 'planning', 'reading_context', 'streaming', 'tool_running', 'validating'].includes(task.status)) {
          restored = true; activeTaskId.current = id; setBusy(true);
          timer = setTimeout(() => void poll(), 600);
        } else if (restored) {
          if (task.status === 'completed' && task.candidate) {
            if (JSON.stringify(current.current ?? null) !== safeGetItem(parentKey(id))) {
              setError('Editor berubah. Hasil tersimpan tersedia pada rincian tugas untuk ditinjau.');
            } else {
              await applyResult(JSON.parse(task.candidate) as T, 'Disusun provider dari tugas tersimpan');
              setNotice('Hasil tugas tersimpan dipulihkan. Pratinjau diperbarui.');
            }
            // Completed: the candidate stays reviewable in task details; the snapshot is no longer needed.
            safeRemoveItem(parentKey(id));
          }
          activeTaskId.current = null; setBusy(false);
        }
      } catch (err) {
        if (!disposed && restored) {
          setError(err instanceof Error ? err.message : 'Status tugas belum dapat dibaca. Buka rincian untuk pemulihan.');
          activeTaskId.current = null; setBusy(false);
        }
      } finally { if (!disposed) setChecking(false); }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [recoveryId]);

  const ready = !!selection.provider && !!selection.modelSelection.modelId;

  const handleSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (busy || activeTaskId.current || disabled || !ready || !prompt.trim()) return;

    setError('');
    setNotice('');
    setBusy(true);

    const taskId = crypto.randomUUID();
    if (recoveryId) safeRemoveItem(parentKey(recoveryId));
    activeTaskId.current = taskId; setRecoveryId(taskId);
    safeSetItem(`forgekit:editor-task:${kind}`, taskId);
    const parentSnapshot = JSON.stringify(currentSpec ?? null);
    safeSetItem(parentKey(taskId), parentSnapshot ?? 'null');
    const choiceSnapshot = selection.snapshot();

    try {
      const result = await generateEditorRecipe<T>({
        kind,
        prompt: prompt.trim(),
        choiceSnapshot,
        currentSpec,
        taskId,
      });

      if (!alive.current || activeTaskId.current !== taskId) return;
      if (JSON.stringify(current.current ?? null) !== parentSnapshot) throw new Error('Editor berubah selama proses. Kandidat disimpan untuk ditinjau; edit terbaru dipertahankan.');
      const attribution = `Disusun oleh ${result.provider?.adapterId ?? choiceSnapshot.providerType} / ${result.provider?.modelId ?? choiceSnapshot.modelId}`;
      await applyResult(result.spec, attribution);
      safeRemoveItem(parentKey(taskId));
      setNotice(`${attribution}. Pratinjau diperbarui.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Penyusunan spesifikasi gagal.');
    } finally {
      if (selection.effectiveAccount) void refreshUsageAfterTask(selection.profiles, taskId, selection.effectiveAccount);
      if (activeTaskId.current === taskId) activeTaskId.current = null;
      if (alive.current) setBusy(false);
    }
  };

  const handleCancel = async () => {
    applying.current?.abort();
    const failed = (err: unknown) => { if (alive.current) setError(`Pembatalan gagal: ${err instanceof Error ? err.message : 'tugas belum dapat dihentikan.'}`); };
    if (recovering && recoveryId) {
      try { await call('cancel_creative', { id: recoveryId }); } catch (err) { failed(err); }
      return;
    }
    if (!activeTaskId.current) return;
    const id = activeTaskId.current; activeTaskId.current = null;
    try {
      await call('cancel_creative', { id });
      if (alive.current) setNotice('Penyusunan dibatalkan.');
    } catch (err) {
      // The task keeps running when cancellation fails; keep tracking it so its result is not dropped.
      if (activeTaskId.current === null) activeTaskId.current = id;
      failed(err);
    }
  };

  return (
    <section className="editor-ai-prompt-bar" aria-label="Penyusunan Spesifikasi AI">
      <form onSubmit={handleSubmit} className="editor-ai-form prompt-composer">
        <header className="prompt-heading"><span className="prompt-heading-icon" aria-hidden="true"><Icon name="spark" /></span><div><h2>Asisten desain</h2><p>Jelaskan ide atau perubahan yang diinginkan.</p></div></header>
        <ObsidianContext />
        <div className="editor-ai-input-row">
          <textarea
            rows={3}
            maxLength={16000}
            className="editor-ai-input prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            disabled={busy || disabled}
            aria-label="Prompt instruksi AI"
          />
        </div>

        <div className="editor-ai-controls-row prompt-toolbar">
          <div className="editor-ai-picker-group prompt-options">
            <ProviderPicker
              profiles={selection.profiles}
              connections={selection.connectionProfiles}
              value={selection.choice}
              onChange={(next) => selection.setChoice(next as FeatureChoice)}
              label="Koneksi AI Fitur Ini"
              onOpenUsage={() => setUsageOpen(true)}
              isCustomOverride={selection.isCustomOverride}
              disabled={busy || disabled}
            />
            <ModelControls selection={selection.modelSelection} disabled={busy || disabled} />
          </div>
          <div className="prompt-actions">
          {busy ? (
            <Button
              type="button"
              className="secondary-button editor-ai-cancel-btn"
              disabled={checking && !generating}
              onClick={() => void handleCancel()}
            >
              Stop
            </Button>
          ) : (
            <button
              type="submit"
              className="button primary-button editor-ai-submit-btn"
              disabled={disabled || !ready || !prompt.trim()}
            >
              <Icon name="spark" />
              <span>Susun</span>
            </button>
          )}
          </div>
        </div>

        {error && (
          <div className="editor-ai-feedback error" role="alert">
            <Status tone="error">{error}</Status>
          </div>
        )}

        {notice && !error && (
          <div className="editor-ai-feedback success" role="status">
            <Status tone="success">{notice}</Status>
          </div>
        )}

        {selection.fallbackNotice && (
          <div className="editor-ai-feedback warning" role="status">
            <Status tone="neutral">{selection.fallbackNotice}</Status>
          </div>
        )}
        {!ready && <a href="#settings?section=providers">Pilih akun dan model</a>}
        <TaskAttempts taskId={recoveryId} running={generating} />
        <TaskRecovery taskId={recoveryId} disabled={generating || checking} showCandidate onBusyChange={setRecovering} onRecovered={async (value) => {
          if (!alive.current) return;
          const result = value as { spec?: T };
          if (!recoveryId || JSON.stringify(current.current ?? null) !== safeGetItem(parentKey(recoveryId))) {
            setError('Kandidat tersedia pada rincian tugas. Editor berubah; hasil tidak diterapkan otomatis.'); return;
          }
          if (result.spec) { await applyResult(result.spec, 'Disusun provider dari checkpoint tugas'); safeRemoveItem(parentKey(recoveryId)); }
        }} />
      </form>
      <OrcaUsagePanel isOpen={usageOpen} onClose={() => setUsageOpen(false)} profiles={selection.profiles} connections={selection.connectionProfiles} defaultSelectedId={selection.modelSelection.provider?.id} />
    </section>
  );
}
