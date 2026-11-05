import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GfxSpec } from '@forgekit/contracts';
import { finishAppExit, loadGfxDraft, saveGfxDraft } from '../../services/tauri';
import { isTauri } from '@tauri-apps/api/core';
import { flushPendingDraft, useGfxDraft } from './useGfxDraft';

const native = vi.hoisted(() => ({
  close: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  quit: undefined as undefined | (() => Promise<void>),
  destroy: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  destroy: native.destroy,
  onCloseRequested: async (handler: typeof native.close) => { native.close = handler; return () => {}; },
}) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (_: string, handler: typeof native.quit) => {
  native.quit = handler; return () => {};
} }));
vi.mock('../../services/tauri', () => ({ loadGfxDraft: vi.fn(), saveGfxDraft: vi.fn(), finishAppExit: vi.fn() }));
const spec: GfxSpec = { schemaVersion: 1, title: '', subtitle: 'Belum selesai', width: -0.5, height: 800, background: '#', accent: '#ff0033', layout: 'centered' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(loadGfxDraft).mockResolvedValue(null);
  vi.mocked(saveGfxDraft).mockImplementation(async (value, baselineVersionId, revision) => ({
    spec: value, baselineVersionId, revision: revision + 1, updatedAt: '1793000000000',
  }));
});
afterEach(() => vi.useRealTimers());

it('waits for native recovery before permitting edits or writes', async () => {
  let resolve!: (draft: Awaited<ReturnType<typeof loadGfxDraft>>) => void;
  vi.mocked(loadGfxDraft).mockReturnValue(new Promise((done) => { resolve = done; }));
  const restore = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useGfxDraft(restore));
  expect(result.current.ready).toBe(false);
  expect(saveGfxDraft).not.toHaveBeenCalled();
  await act(async () => { resolve({ spec, baselineVersionId: null, revision: 7, updatedAt: 'now' }); });
  expect(restore).toHaveBeenCalledWith(expect.objectContaining({ spec, revision: 7 }));
  expect(result.current.ready).toBe(true);
  expect(saveGfxDraft).not.toHaveBeenCalled();
});

it('debounces unfinished fields and serializes changes arriving during an IPC write', async () => {
  const { result } = renderHook(() => useGfxDraft(async () => {}));
  await waitFor(() => expect(result.current.ready).toBe(true));
  vi.useFakeTimers();
  act(() => { result.current.queue(spec, null); result.current.queue({ ...spec, title: 'Terbaru' }, null); });
  expect(saveGfxDraft).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(saveGfxDraft).toHaveBeenCalledTimes(1);
  expect(saveGfxDraft).toHaveBeenLastCalledWith({ ...spec, title: 'Terbaru' }, null, 0);
  let finish!: (draft: Awaited<ReturnType<typeof saveGfxDraft>>) => void;
  vi.mocked(saveGfxDraft).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => { result.current.queue(spec, null); });
  let flushing!: Promise<void>;
  act(() => { flushing = flushPendingDraft(); });
  act(() => { result.current.queue({ ...spec, title: 'Saat menulis' }, null); });
  await act(async () => {
    finish({ spec, baselineVersionId: null, revision: 2, updatedAt: 'later' });
    await flushing;
  });
  expect(saveGfxDraft).toHaveBeenCalledTimes(3);
  expect(saveGfxDraft).toHaveBeenLastCalledWith({ ...spec, title: 'Saat menulis' }, null, 2);
  expect(result.current.notice).toContain('tersimpan otomatis');
});

it('keeps failed snapshot and revision for explicit retry', async () => {
  const { result } = renderHook(() => useGfxDraft(async () => {}));
  await waitFor(() => expect(result.current.ready).toBe(true));
  vi.mocked(saveGfxDraft).mockRejectedValueOnce(new Error('Disk penuh'));
  act(() => result.current.queue(spec, null));
  await act(async () => { await expect(flushPendingDraft()).rejects.toThrow('Disk penuh'); });
  expect(result.current.error).toBe(true);
  expect(result.current.notice).toContain('belum tersimpan');
  await act(async () => { await result.current.retry(); });
  expect(saveGfxDraft).toHaveBeenLastCalledWith(spec, null, 0);
  expect(result.current.error).toBe(false);
});

it.each(['close', 'quit'] as const)('flushes before native %s and prevents exit on write failure', async (action) => {
  vi.mocked(isTauri).mockReturnValue(true);
  const { result } = renderHook(() => useGfxDraft(async () => {}));
  await waitFor(() => expect(result.current.ready).toBe(true));
  vi.mocked(saveGfxDraft).mockRejectedValueOnce(new Error('Disk penuh'));
  act(() => result.current.queue(spec, null));
  const preventDefault = vi.fn();
  const request = async () => { if (action === 'close') await native.close!({ preventDefault }); else await native.quit!(); };
  await act(request);
  expect(result.current.notice).toContain('tetap terbuka');
  expect(native.destroy).not.toHaveBeenCalled();
  expect(finishAppExit).not.toHaveBeenCalled();
  await act(request);
  expect(saveGfxDraft).toHaveBeenLastCalledWith(spec, null, 0);
  expect(action === 'close' ? native.destroy : finishAppExit).toHaveBeenCalledTimes(1);
  if (action === 'close') expect(preventDefault).toHaveBeenCalledTimes(2);
});
