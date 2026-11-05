import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Mesh } from 'three';
import { call } from '../../services/tauri';
import { useModelBuildProgress } from './useModelBuildProgress';
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
const preview = { schemaVersion: 1, name: 'Actual Blender candidate', meshes: [{ id: 'body', name: 'Body',
  positions: [0,0,0, 1,0,0, 0,1,0], normals: [0,0,1, 0,0,1, 0,0,1], color: '#aa2233', material: 'Metal' }] };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it('requests each preview only once, preserves the mesh on phase updates and rejects corrupt replacements', async () => {
  vi.useFakeTimers();
  vi.mocked(call).mockResolvedValueOnce({ phase: 'rendering', previewId: 'one', mesh: preview })
    .mockResolvedValueOnce({ phase: 'comparing_reference', previewId: 'one' })
    .mockResolvedValueOnce({ phase: 'rendering', previewId: 'bad', mesh: { ...preview, meshes: [] } });
  const { result, unmount } = renderHook(() => useModelBuildProgress('task-A', undefined, true));
  await act(async () => {});
  const model = result.current.model!;
  expect(model.name).toBe('Actual Blender candidate');
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(call).toHaveBeenLastCalledWith('get_model_build_progress', { taskId: 'task-A', versionId: undefined, knownPreview: 'one' });
  expect(result.current.model).toBe(model); expect(result.current.phase).toBe('comparing_reference');
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(result.current.model).toBe(model); expect(result.current.previewId).toBe('one');
  const dispose = vi.spyOn((model.children[0] as Mesh).geometry, 'dispose');
  unmount(); expect(dispose).toHaveBeenCalledOnce();
});

it('ignores late responses from a previous tab/job and stops polling after completion', async () => {
  vi.useFakeTimers(); let complete: (value: unknown) => void = () => {};
  vi.mocked(call).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValue({ phase: 'planning' });
  const { result, rerender } = renderHook(({ task, running }) => useModelBuildProgress(task, undefined, running), { initialProps: { task: 'old', running: true } });
  rerender({ task: 'new', running: true });
  await act(async () => { complete({ phase: 'rendering', previewId: 'old', mesh: preview }); });
  expect(result.current.model).toBeNull();
  rerender({ task: 'new', running: false }); const count = vi.mocked(call).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(call).toHaveBeenCalledTimes(count);
});
