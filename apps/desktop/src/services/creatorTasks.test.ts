import { beforeEach, expect, it, vi } from 'vitest';
import { createWorkTask, updateWorkTask } from './creatorWorkspace';
import { cancelCreatorTask, runCreatorTask } from './creatorTasks';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('./creatorWorkspace', () => ({ createWorkTask: vi.fn(), updateWorkTask: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createWorkTask).mockResolvedValue({ id: 'work-1' } as never);
  vi.mocked(updateWorkTask).mockImplementation(async (_id, status) => ({ status }) as never);
});
it('records ordered checkpoints and receipts; native transaction owns save completion', async () => {
  const result = await runCreatorTask('icon', 'export', {}, new AbortController(), async (task) => {
    await task.checkpoint('saving');
    await task.checkpoint('exporting', { versionId: 'image-1' });
    await task.checkpoint('exporting', { relativePath: 'exports/icon.png', sha256: 'verified' });
    return 'done';
  });
  expect(result).toBe('done');
  expect(updateWorkTask).toHaveBeenLastCalledWith('work-1', 'succeeded', 'complete', { versionId: 'image-1', relativePath: 'exports/icon.png', sha256: 'verified' });
  vi.mocked(updateWorkTask).mockClear();
  await runCreatorTask('sfx', 'save', {}, new AbortController(), async (task) => task.checkpoint('saving'));
  expect(vi.mocked(updateWorkTask).mock.calls.every((call) => call[1] !== 'succeeded')).toBe(true);
});
it('requests cancellation, aborts worker, then acknowledges after cleanup', async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  let cleaned = false;
  const running = runCreatorTask('sfx', 'render', {}, controller, async (task) => {
    entered();
    await new Promise<void>((_resolve, reject) => task.signal.addEventListener('abort', () => {
      cleaned = true;
      reject(new DOMException('Stopped', 'AbortError'));
    }, { once: true }));
  });
  const rejected = expect(running).rejects.toThrow('Stopped');
  await ready;
  await cancelCreatorTask('work-1');
  await rejected;
  expect(cleaned).toBe(true);
  expect(controller.signal.aborted).toBe(true);
  expect(updateWorkTask).toHaveBeenLastCalledWith('work-1', 'cancelled', 'validating', null, 'Stopped');
});
it('records failures without claiming successful completion', async () => {
  await expect(runCreatorTask('texture', 'render', {}, new AbortController(), async () => { throw new Error('Worker crashed'); })).rejects.toThrow('Worker crashed');
  expect(updateWorkTask).toHaveBeenLastCalledWith('work-1', 'failed', 'validating', null, 'Worker crashed');
});
