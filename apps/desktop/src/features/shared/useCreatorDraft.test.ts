import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { loadCreatorDraft, saveCreatorDraft, type CreatorDraft } from '../../services/creatorWorkspace';
import { flushPendingDraft } from '../gfx/useGfxDraft';
import { useCreatorDraft } from './useCreatorDraft';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('../../services/creatorWorkspace', () => ({ loadCreatorDraft: vi.fn(), saveCreatorDraft: vi.fn() }));
const stored: CreatorDraft<{ name: string }> = { kind: 'icon', spec: { name: '' }, baselineVersionId: 'version-1', revision: 7, engineVersion: 1, updatedAt: '1' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(loadCreatorDraft).mockResolvedValue(null);
  vi.mocked(saveCreatorDraft).mockImplementation(async (draft) => ({ ...draft, revision: draft.revision + 1, updatedAt: '2' }));
});
afterEach(() => vi.useRealTimers());

it('waits for restoration and does not overwrite recovered draft during startup', async () => {
  let finish!: (value: typeof stored) => void;
  vi.mocked(loadCreatorDraft).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const restore = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useCreatorDraft('icon', restore));
  expect(result.current.ready).toBe(false);
  act(() => result.current.queue({ name: 'Premature edit' }, null));
  expect(saveCreatorDraft).not.toHaveBeenCalled();
  await act(async () => { finish(stored); });
  expect(restore).toHaveBeenCalledWith(stored);
  expect(result.current.ready).toBe(true);
  expect(saveCreatorDraft).not.toHaveBeenCalled();
  act(() => result.current.queue({ name: 'Recovered edit' }, 'version-1'));
  await act(async () => { await flushPendingDraft(); });
  expect(saveCreatorDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 7, baselineVersionId: 'version-1', spec: { name: 'Recovered edit' } }));
});

it('debounces and serializes edits arriving during an in-flight write', async () => {
  const { result } = renderHook(() => useCreatorDraft('texture', async () => {}));
  await waitFor(() => expect(result.current.ready).toBe(true));
  vi.useFakeTimers();
  act(() => { result.current.queue({ name: 'First' }, null); result.current.queue({ name: 'Newest' }, null); });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(saveCreatorDraft).toHaveBeenCalledTimes(1);
  expect(saveCreatorDraft).toHaveBeenLastCalledWith(expect.objectContaining({ spec: { name: 'Newest' }, revision: 0 }));
  let finish!: (value: CreatorDraft) => void;
  vi.mocked(saveCreatorDraft).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => result.current.queue({ name: 'Writing' }, null));
  let flushing!: Promise<void>;
  act(() => { flushing = flushPendingDraft(); });
  act(() => result.current.queue({ name: 'During write' }, null));
  await act(async () => { finish({ ...stored, kind: 'texture', revision: 2 }); await flushing; });
  expect(saveCreatorDraft).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2, spec: { name: 'During write' } }));
  expect(result.current.notice).toContain('tersimpan otomatis');
});

it('retains failed revision and blocks close/backup until retry succeeds', async () => {
  const { result } = renderHook(() => useCreatorDraft('sfx', async () => {}));
  await waitFor(() => expect(result.current.ready).toBe(true));
  vi.mocked(saveCreatorDraft).mockRejectedValueOnce(new Error('Konflik revisi'));
  act(() => result.current.queue({ name: 'Unsaved' }, null));
  await act(async () => { await expect(flushPendingDraft()).rejects.toThrow('Konflik revisi'); });
  expect(result.current.error).toBe(true);
  act(() => result.current.queue({ name: 'Latest after error' }, null));
  await act(async () => { await result.current.retry(); });
  expect(saveCreatorDraft).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 0, spec: { name: 'Latest after error' } }));
  expect(result.current.error).toBe(false);
});

it('rejects future engine drafts and keeps browser persistence status honest', async () => {
  vi.mocked(loadCreatorDraft).mockResolvedValue({ ...stored, engineVersion: 99 });
  const restore = vi.fn();
  const hook = renderHook(() => useCreatorDraft('icon', restore));
  await waitFor(() => expect(hook.result.current.error).toBe(true));
  expect(hook.result.current.ready).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  await expect(flushPendingDraft()).rejects.toThrow('belum berhasil dimuat');
  hook.unmount();
  vi.mocked(isTauri).mockReturnValue(false);
  const browser = renderHook(() => useCreatorDraft('icon', restore));
  act(() => browser.result.current.queue({ name: 'Browser edit' }, null));
  expect(browser.result.current.ready).toBe(true);
  expect(browser.result.current.notice).toContain('memerlukan aplikasi desktop');
  expect(saveCreatorDraft).not.toHaveBeenCalled();
});
