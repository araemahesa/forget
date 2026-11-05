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
import { refreshUsageAfterTask } from '../../services/providerUsage';
import { useFeatureProviderSelection } from '../../services/featureSelection';

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

export function useCreativeTask(kind: ProceduralKind) {
  const selection = useFeatureProviderSelection(kind);
  const { profiles, defaultProvider, connectionProfiles, modelSelection, choice: providerChoice } = selection;
  const provider = modelSelection.provider;

  const [quality, setQuality] = useState<QualityProfileId>('balanced');
  const [version, setVersion] = useState<CreativeVersion | null>(null);
  const [versions, setVersions] = useState<CreativeVersion[]>([]);
  const [task, setTask] = useState<CreativeTask | null>(null);
  const [attemptTaskId, setAttemptTaskId] = useState<string | null>(() => localStorage.getItem(`forgekit:creative-task:${kind}`));
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cancelled = useRef(false);
  const active = useRef<string | null>(null);
  const restored = useRef<string | null>(null);
  const alive = useRef(true);
  const loadRevision = useRef(0);

  useEffect(() => {
    if (selection.fallbackNotice) {
      setNotice(selection.fallbackNotice);
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
      if (values.length && alive.current && !active.current && revision === loadRevision.current) {
        const loaded = await call<CreativeVersion>('load_creative_version', { id: values[0].id });
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
    void call<CreativeTask>('get_creative_task', { id }).then((value) => {
      if (!current || active.current || value?.id !== id) return;
      setTask(value);
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
            if (restored.current === id && ['completed', 'preview_ready', 'failed', 'cancelled', 'interrupted'].includes(value.status)) {
              try {
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

  async function run(prompt: string, parentVersionId: string | null, document?: CreativeSpecification) {
    if (active.current || busy || recovering) return;
    if (!document && !provider) {
      setError('Pilih akun provider dan model sebelum membuat karya.');
      return;
    }
    if (!prompt.trim()) {
      setError('Isi prompt terlebih dahulu.');
      return;
    }

    // Capture frozen snapshot of choice at task start
    const choiceSnapshot = selection.snapshot();
    const id = crypto.randomUUID();
    active.current = id;
    cancelled.current = false;
    setAttemptTaskId(id); localStorage.setItem(`forgekit:creative-task:${kind}`, id);
    if (!document) setSubmittedPrompt(prompt);
    const releaseStudio = acquireStudioTask();
    loadRevision.current++;
    setBusy(true);
    setCancelling(false);
    setError('');
    setNotice('');
    setTask(null);

    try {
      const studio = document ? null : await refreshStudioContext();
      if (active.current !== id || cancelled.current) return;
      const result = document
        ? await call<CreativeVersion>('save_creative_revision', { taskId: id, parentVersionId, document })
        : await call<CreativeVersion>('generate_creative', {
            studioId: studio?.studio.studioId,
            contextSnapshotId: studio?.context?.id,
            request: {
              taskId: id,
              kind,
              prompt,
              quality,
              providerId: choiceSnapshot.providerId,
              modelId: choiceSnapshot.modelId,
              reasoningEffort: choiceSnapshot.reasoningEffort,
              parentVersionId,
            },
          });
      if (alive.current && active.current === id && !cancelled.current) {
        setVersion(validateCreativeVersion(result, kind));
        setNotice('Artefak prosedural tersimpan. Belum diterapkan ke Studio.');
        await refresh();
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Generasi gagal. Versi sebelumnya dipertahankan.');
    } finally {
      releaseStudio();
      if (!document && selection.effectiveAccount) {
        void refreshUsageAfterTask(profiles, id, selection.effectiveAccount);
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
      await call('cancel_creative', { id });
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
    try {
      const loaded = validateCreativeVersion(await call<CreativeVersion>('load_creative_version', { id }), kind);
      if (alive.current && revision === loadRevision.current) {
        setVersion(loaded);
        setAttemptTaskId(loaded.taskId);
        setTask(null);
      }
    } catch (e) {
      if (alive.current && revision === loadRevision.current) setError(e instanceof Error ? e.message : 'Versi gagal dibuka.');
    }
  }

  return {
    submittedPrompt,
    kind,
    profiles,
    connectionProfiles,
    provider,
    modelSelection,
    providerChoice,
    setProviderChoice: selection.setChoice,
    promoteToPrimary: selection.promoteToPrimary,
    isCustomOverride: selection.isCustomOverride,
    isInherited: selection.isInherited,
    selection,
    defaultProvider,
    quality,
    setQuality,
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
    recovered: async (value: unknown) => { if (alive.current) { setVersion(validateCreativeVersion(value as CreativeVersion, kind)); setError(''); setNotice('Hasil dari checkpoint tersimpan.'); await refresh(); } },
  };
}
