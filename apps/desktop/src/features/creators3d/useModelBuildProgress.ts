import { useEffect, useState } from 'react';
import type { Group } from 'three';
import { call } from '../../services/tauri';
import { disposeGeometry } from '../create/geometry';
import { buildBlenderPreview } from './blenderPreview';

type Progress = { phase: string; previewId?: string; mesh?: unknown; builtParts?: number; totalParts?: number };
type Snapshot = Omit<Progress, 'mesh'> & { model: Group | null; job: string };
export function useModelBuildProgress(taskId: string | undefined, versionId: string | undefined, running: boolean) {
  const job = taskId ? `task:${taskId}` : versionId ? `version:${versionId}` : '';
  const [snapshot, setSnapshot] = useState<Snapshot>({ job: '', phase: 'planning', model: null });
  useEffect(() => () => { if (snapshot.model) disposeGeometry(snapshot.model); }, [snapshot.model]);
  useEffect(() => {
    if (!running || !job) { setSnapshot(previous => previous.model ? { ...previous, model: null } : previous); return; }
    let stopped = false, knownPreview: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    setSnapshot({ job, phase: 'planning', model: null });
    async function poll() {
      try {
        const value = await call<Progress>('get_model_build_progress', { taskId, versionId: taskId ? undefined : versionId, knownPreview });
        if (stopped) return;
        if (!value || typeof value.phase !== 'string') throw new Error('Status Blender tidak sah.');
        const model = value.mesh && typeof value.previewId === 'string' && value.previewId && value.previewId !== knownPreview ? buildBlenderPreview(value.mesh) : undefined;
        // A preview becomes known only after its buffers pass the same checks as a saved Blender result.
        if (model) knownPreview = value.previewId;
        setSnapshot(previous => ({ job, phase: value.phase, builtParts: value.builtParts, totalParts: value.totalParts,
          previewId: knownPreview, model: model ?? previous.model }));
      } catch { /* The journal may not exist yet. Keep the last valid preview; never substitute geometry. */ }
      if (!stopped) timer = setTimeout(() => void poll(), 750);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [job, running, taskId, versionId]);
  return snapshot.job === job ? snapshot : { phase: 'planning', model: null, previewId: undefined, builtParts: undefined, totalParts: undefined };
}
