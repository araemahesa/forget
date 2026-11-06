import type { ReferenceImage } from '../../services/references';
import { useEffect, useRef, useState } from 'react';
import {
  validateAnimationRecipe, validateCutsceneRecipe, validateGuiRecipe,
  validateModel3dRecipe, validateMusicRecipe, validateNpcDialogueRecipe,
  validateTexture3dRecipe, validateVfxRecipe, validateSkyboxRecipe,
  type CreativeSpecification, type CreativeTask, type CreativeVersion,
  type ProceduralKind, type QualityProfileId,
} from '@forgekit/contracts';
import { acquireStudioTask, refreshStudioContext } from '../../services/studioState';
import { call } from '../../services/tauri';
import { safeGetItem, safeSetItem } from '../../services/safeStorage';
import { refreshUsageAfterTask } from '../../services/providerUsage';
import { getFeatureChoice, useFeatureProviderSelection } from '../../services/featureSelection';

export function validateCreativeVersion(value: CreativeVersion, kind: ProceduralKind) {
  if (!value || value.document?.kind !== kind || value.engineVersion !== 1 || typeof value.id !== 'string' || !value.artifact?.sha256) throw new Error('Versi artefak tidak sah atau engine belum didukung.');
  const issues =
    value.document.kind === 'model3d' ? validateModel3dRecipe(value.document.recipe) :
    value.document.kind === 'animation' ? validateAnimationRecipe(value.document.recipe) :
    value.document.kind === 'vfx' ? validateVfxRecipe(value.document.recipe) :
    value.document.kind === 'interface' ? validateGuiRecipe(value.document.recipe) :
    value.document.kind === 'npc' ? validateNpcDialogueRecipe(value.document.recipe) :
    value.document.kind === 'cutscene' ? validateCutsceneRecipe(value.document.recipe) :
    value.document.kind === 'material' ? validateTexture3dRecipe(value.document.recipe) :
    value.document.kind === 'music' ? validateMusicRecipe(value.document.recipe) :
    value.document.kind === 'sky' ? validateSkyboxRecipe(value.document.recipe) :
    [];
  if (issues.length) throw new Error(issues[0].message);
  return value;
}

export function useCreativeTask(kind: ProceduralKind, session?: { id: string; initialVersionId?: string; restoreLatest?: boolean }) {
  const storageKey = session?.id ? `${kind}:${session.id}` : kind;
  const initial = useRef(session);
  const selection = useFeatureProviderSelection(kind);
  const { profiles, defaultProvider, connectionProfiles, modelSelection, choice: providerChoice } = selection;
  const provider = modelSelection.provider;

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [version, setVersion] = useState<CreativeVersion | null>(null);
  const [versions, setVersions] = useState<CreativeVersion[]>([]);
  const [task, setTask] = useState<CreativeTask | null>(null);
  const [attemptTaskId, setAttemptTaskId] = useState<string | null>(() => safeGetItem(`forgekit:creative-task:${storageKey}`));
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [applicationResult, setApplicationResult] = useState('');
  const activeThread = useRef<string | null>(null);
  const cancelled = useRef(false);
  const active = useRef<string | null>(null);
  const restored = useRef<string | null>(null);
  const alive = useRef(true);
  const loadRevision = useRef(0);

  const shownFallback = useRef('');
  useEffect(() => {
    if (selection.fallbackNotice) {
      shownFallback.current = selection.fallbackNotice;
      setNotice(selection.fallbackNotice);
    } else if (shownFallback.current) {
      // Clear only the fallback text; task notices set meanwhile stay visible.
      const stale = shownFallback.current; shownFallback.current = '';
      setNotice((current) => current === stale ? '' : current);
    }
  }, [selection.fallbackNotice]);

  async function refresh() {
    const values = await call<CreativeVersion[]>('list_creative_versions', { kind });
    if (!Array.isArray(values)) throw new Error('Daftar versi tidak sah.');
    const valid = values.map((item) => validateCreativeVersion(item, kind));
    if (alive.current) setVersions(valid);
    return valid;
  }

  useEffect(() => {
    alive.current = true;
    const revision = ++loadRevision.current;
    void refresh().then(async (values) => {
      const id = initial.current?.initialVersionId ?? ((!initial.current || initial.current.restoreLatest) ? values[0]?.id : undefined);
      if (id && alive.current && !active.current && revision === loadRevision.current) {
        const loaded = await call<CreativeVersion>('load_creative_version', { id });
        if (alive.current && !active.current && revision === loadRevision.current) {
          setVersion(validateCreativeVersion(loaded, kind));
          setAttemptTaskId((previous) => previous ?? loaded.taskId);
        }
      }
    }).catch((e: Error) => { if (alive.current) setError(e.message); });
    return () => { alive.current = false; loadRevision.current++; };
  }, [kind]);

  useEffect(() => {
    if (!attemptTaskId || active.current) return;
    let current = true;
    const id = attemptTaskId;
    void call<CreativeTask>('get_creative_task', { id }).then(async (value) => {
      if (!current || active.current || value?.id !== id) return;
      setTask(value);
      if (value.status === 'failed') setError(value.error ?? 'Generasi belum selesai. Hasil sebelumnya dipertahankan.');
      if (typeof value.prompt === 'string') setSubmittedPrompt(value.prompt);
      const images = (value as CreativeTask & { referenceImages?: ReferenceImage[] }).referenceImages;
      if (Array.isArray(images)) setReferenceImages(previous => previous.length ? previous : images);
      if (value.versionId && ['completed', 'preview_ready'].includes(value.status)) {
        const loaded = await call<CreativeVersion>('load_creative_version', { id: value.versionId });
        if (!current || active.current) return;
        setVersion(validateCreativeVersion(loaded, kind));
      }
      activeThread.current = (value as CreativeTask & { threadId?: string }).threadId ?? null;
      if (value.status === 'completed' && activeThread.current) {
        const messages = await call<{ role: string; content: string }[]>('load_chat_thread', { threadId: activeThread.current });
        if (current && !active.current) setApplicationResult(messages.filter(message => message.role === 'assistant').at(-1)?.content ?? 'Hasil tugas tersedia di AI Chat.');
      }
      if (['queued', 'planning', 'reading_context', 'streaming', 'tool_running', 'validating'].includes(value.status)) {
        restored.current = id; active.current = id; setBusy(true);
      }
    }).catch(() => { /* A missing/legacy task never starts new provider work. */ });
    return () => { current = false; };
  }, [attemptTaskId]);

  useEffect(() => {
    if (!busy) return;
    let stopped = false;
    const release = restored.current ? acquireStudioTask() : undefined;
    let timeout: ReturnType<typeof setTimeout>;
    async function poll() {
      const id = active.current;
      if (!stopped && id) {
        try {
          const value = await call<CreativeTask>('get_creative_task', { id });
          if (!stopped && active.current === id) {
            setTask(value);
            if (['failed', 'cancelled', 'interrupted'].includes(value.status)) setError(value.error ?? 'Proses terhenti. Pilih akun atau model lain, lalu coba lagi.');
            if (restored.current === id && ['completed', 'preview_ready', 'failed', 'cancelled', 'interrupted'].includes(value.status)) {
              try {
                const threadId = (value as CreativeTask & { threadId?: string }).threadId;
                if (threadId && value.status === 'completed') {
                  const messages = await call<{ role: string; content: string }[]>('load_chat_thread', { threadId });
                  if (!stopped && active.current === id) setApplicationResult(messages.filter(message => message.role === 'assistant').at(-1)?.content ?? 'Hasil tugas tersedia di AI Chat.');
                }
                if (value.versionId) {
                  const loaded = await call<CreativeVersion>('load_creative_version', { id: value.versionId });
                  if (stopped || active.current !== id) return;
                  setVersion(validateCreativeVersion(loaded, kind));
                  await refresh();
                }
              } catch (e) {
                if (!stopped) setError(e instanceof Error ? e.message : 'Hasil tersimpan belum dapat dibuka. Coba lagi melalui daftar versi.');
              } finally {
                if (!stopped && active.current === id) {
                  restored.current = null; active.current = null; setBusy(false); setCancelling(false); release?.();
                }
              }
            }
          }
        } catch {
          /* Creation may not have reached journal yet. */
        }
      }
      if (!stopped) timeout = setTimeout(() => { void poll(); }, 500);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timeout); release?.(); };
  }, [busy]);

  async function run(prompt: string, parentVersionId: string | null, document?: CreativeSpecification, applyVersionId?: string) {
    if (active.current || busy || recovering) return;
    if (!document && !provider) {
      setError('Pilih akun provider dan model sebelum membuat karya.');
      return;
    }
    if (attachmentsBusy) { setError('Tunggu sampai gambar selesai diproses.'); return; }
    const imageInput = kind === 'model3d' && !parentVersionId && !document && !applyVersionId && referenceImages.some(image => !!image.dataUrl && (!image.kind || image.kind === 'image'));
    if (!prompt.trim() && !imageInput) {
      setError('Isi prompt terlebih dahulu.');
      return;
    }

    // Capture frozen snapshot of choice at task start
    const choiceSnapshot = selection.snapshot();
    const id = crypto.randomUUID();
    active.current = id;
    cancelled.current = false;
    setAttemptTaskId(id); safeSetItem(`forgekit:creative-task:${storageKey}`, id);
    if (!document) setSubmittedPrompt(prompt);
    const releaseStudio = acquireStudioTask();
    loadRevision.current++;
    setBusy(true);
    setCancelling(false);
    setError('');
    setNotice('');
    setApplicationResult('');
    activeThread.current = null;
    setTask(null);

    try {
      const studio = document ? null : await refreshStudioContext();
      if (active.current !== id || cancelled.current) return;
      if (applyVersionId) {
        if (!studio?.context) throw new Error('Hubungkan dan verifikasi map tujuan di Roblox Studio terlebih dahulu.');
        const thread = await call<{ id: string }>('create_chat_thread', { title: `Terapkan ${kind}`, providerId: choiceSnapshot.providerId, model: choiceSnapshot.modelId, systemPrompt: null });
        activeThread.current = thread.id;
        if (cancelled.current || active.current !== id) return;
        const result = await call<{ content: string }>('send_chat_message', {
          threadId: thread.id, requestId: id, userContent: prompt,
          provider: { ...provider, model: choiceSnapshot.modelId, reasoningEffort: choiceSnapshot.reasoningEffort },
          mode: 'auto', studioId: studio.studio.studioId, contextSnapshotId: studio.context?.id,
          creativeVersionId: applyVersionId,
        });
        if (alive.current && active.current === id) setApplicationResult(result.content);
        return;
      }
      const result = document
        ? await call<CreativeVersion>('save_creative_revision', { taskId: id, parentVersionId, document })
        : await call<CreativeVersion>('generate_creative', {
            studioId: studio?.studio.studioId,
            contextSnapshotId: studio?.context?.id,
            request: {
              taskId: id,
              kind,
              prompt,
              quality: 'high',
              providerId: choiceSnapshot.providerId,
              modelId: choiceSnapshot.modelId,
              reasoningEffort: choiceSnapshot.reasoningEffort,
              parentVersionId,
              referenceImages,
            },
          });
      if (alive.current && active.current === id && !cancelled.current) {
        setVersion(validateCreativeVersion(result, kind));
        setNotice(kind === 'model3d' ? 'Model Blender tersimpan.' : 'Artefak prosedural tersimpan. Belum diterapkan ke Studio.');
        await refresh();
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Generasi gagal. Versi sebelumnya dipertahankan.');
    } finally {
      releaseStudio();
      if (!document && selection.effectiveAccount) {
        void refreshUsageAfterTask(profiles, id, selection.effectiveAccount);
        try {
          const attempts = await call<{ profileId: string }[]>('list_task_attempts', { taskId: id });
          const used = Array.isArray(attempts) ? attempts.at(-1)?.profileId : undefined;
          if (used && alive.current && profiles.some(p => p.id === used) && getFeatureChoice(kind) === choiceSnapshot.providerId) selection.setChoice(used);
        } catch { /* Attempt history can be refreshed without blocking the completed task. */ }
      }
      try {
        const value = await call<CreativeTask>('get_creative_task', { id });
        if (alive.current) setTask(value);
      } catch {
        /* Journal read fallback */
      }
      if (active.current === id) active.current = null;
      if (alive.current) {
        setBusy(false);
        setCancelling(false);
      }
    }
  }

  async function stop() {
    const id = active.current;
    if (!id) return;
    cancelled.current = true;
    setCancelling(true);
    try {
      if (activeThread.current) await call('cancel_chat_stream', { threadId: activeThread.current });
      else await call('cancel_creative', { id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Permintaan Stop gagal.');
      setCancelling(false);
    }
  }

  async function open(id: string) {
    if (active.current || busy || recovering) return;
    const revision = ++loadRevision.current;
    setError('');
    setNotice('');
    setApplicationResult('');
    activeThread.current = null;
    try {
      const loaded = validateCreativeVersion(await call<CreativeVersion>('load_creative_version', { id }), kind);
      if (alive.current && revision === loadRevision.current) {
        setVersion(loaded);
        setAttemptTaskId(loaded.taskId);
        safeSetItem(`forgekit:creative-task:${storageKey}`, loaded.taskId);
        setSubmittedPrompt('');
        setTask(null);
      }
    } catch (e) {
      if (alive.current && revision === loadRevision.current) setError(e instanceof Error ? e.message : 'Versi gagal dibuka.');
    }
  }

  return {
    storageKey,
    referenceImages, setReferenceImages, attachmentsBusy, setAttachmentsBusy,
    submittedPrompt,
    applicationResult,
    applicationThreadId: activeThread.current,
    apply: () => version ? run(`Terapkan hasil ${kind} tersimpan ke map tujuan. Inspeksi konteks aktual dan periksa hasil setelah perubahan; jangan mengganti rancangan dengan preset. Jika melibatkan karakter, gunakan Humanoid Roblox R6/R15 asli: inspeksi dan gunakan rig yang ada; jika perlu rig baru, gunakan Players:CreateHumanoidModelFromDescriptionAsync dengan HumanoidDescription dan Enum.HumanoidRigType yang sesuai. Pertahankan Motor6D, nama body part dan Animator; jangan membuat mannequin dari Part lepas. Inspeksi rig aktual sebelum memasang animasi.`, version.id, undefined, version.id) : Promise.resolve(),
    kind,
    profiles,
    connectionProfiles,
    provider,
    modelSelection,
    providerChoice,
    setProviderChoice: selection.setChoice,
    isCustomOverride: selection.isCustomOverride,
    isInherited: selection.isInherited,
    selection,
    defaultProvider,
    version,
    versions,
    task,
    attemptTaskId,
    busy: busy || recovering,
    generating: busy,
    setRecovering,
    cancelling,
    error,
    notice,
    setError,
    setNotice,
    run,
    stop,
    open,
    recovered: async (value: unknown) => { if (alive.current && value && typeof value === 'object' && 'message' in value) { const message = (value as { message: { content?: string } }).message; setApplicationResult(message.content ?? 'Hasil pemulihan tersedia di AI Chat.'); return; } if (alive.current) { setVersion(validateCreativeVersion(value as CreativeVersion, kind)); setError(''); setNotice('Hasil dari checkpoint tersimpan.'); await refresh(); } },
  };
}
