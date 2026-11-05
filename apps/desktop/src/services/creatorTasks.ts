import { isTauri } from '@tauri-apps/api/core';
import { createWorkTask, updateWorkTask, type CreatorKind, type WorkTask } from './creatorWorkspace';

const active = new Map<string, AbortController>();
const changed = () => window.dispatchEvent(new Event('forgekit:tasks-changed'));
const aborted = () => new DOMException('Tugas dibatalkan.', 'AbortError');
export type CreatorTaskContext = {
  id?: string; signal: AbortSignal;
  checkpoint: (stage: string, receipt?: Record<string, unknown>) => Promise<void>;
};

export async function cancelCreatorTask(id: string) {
  const task = await updateWorkTask(id, 'cancel_requested', 'stopped');
  active.get(id)?.abort();
  changed();
  return task;
}

export async function runCreatorTask<T>(
  kind: CreatorKind, action: WorkTask['action'], input: unknown,
  controller: AbortController, operation: (task: CreatorTaskContext) => Promise<T>,
): Promise<T> {
  // Browser preview runs local builders; native-only saves still reject through IPC.
  const task = isTauri() ? await createWorkTask(kind, action, input) : null;
  let stage = 'validating';
  let receipt: Record<string, unknown> | undefined;
  const context: CreatorTaskContext = {
    id: task?.id, signal: controller.signal,
    checkpoint: async (next, partial) => {
      if (controller.signal.aborted) throw aborted();
      stage = next;
      if (partial) receipt = { ...receipt, ...partial };
      if (task) {
        const updated = await updateWorkTask(task.id, 'running', next, receipt ?? null);
        if (updated.status === 'cancel_requested') { controller.abort(); throw aborted(); }
      }
      changed();
    },
  };
  if (task) active.set(task.id, controller);
  changed();
  try {
    await context.checkpoint(stage);
    const result = await operation(context);
    // Save completion belongs to the same native transaction as the new version.
    if (task && action !== 'save') {
      if (controller.signal.aborted) throw aborted();
      await updateWorkTask(task.id, 'succeeded', 'complete', receipt ?? null);
    }
    return result;
  } catch (failure) {
    if (task) {
      const message = failure instanceof Error || failure instanceof DOMException ? failure.message : 'Operasi gagal.';
      try {
        if (controller.signal.aborted) {
          await updateWorkTask(task.id, 'cancel_requested', stage, receipt ?? null);
          await updateWorkTask(task.id, 'cancelled', stage, receipt ?? null, message.slice(0, 4096));
        } else {
          await updateWorkTask(task.id, 'failed', stage, receipt ?? null, message.slice(0, 4096));
        }
      } catch (recordFailure) {
        // A committed save is already terminal; never replace it with a false failure.
        window.dispatchEvent(new CustomEvent('forgekit:activity', { detail: {
          message: `Periksa receipt tugas ${task.id}: ${recordFailure instanceof Error ? recordFailure.message : 'Status belum dapat dicatat.'}`,
          tone: 'error', time: Date.now(),
        } }));
      }
    }
    throw failure;
  } finally {
    if (task) active.delete(task.id);
    changed();
  }
}
