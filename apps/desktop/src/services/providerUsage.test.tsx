import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AiProviderProfile } from '@forgekit/contracts';
import { loadProviderUsage, refreshProviderUsage, refreshUsageAfterTask, useProviderUsage, validUsage, type ProviderUsage } from './providerUsage';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('./tauri', () => ({ call: invoke }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function account(id: string): AiProviderProfile {
  return { id, name: id, providerType: 'openai', model: 'model', baseUrl: 'https://api.openai.com/v1', keyReference: `key-${id}`, isDefault: false, createdAt: '1', updatedAt: '1' };
}
function usage(id: string, usedPercent = 25): ProviderUsage {
  return { profileId: id, status: 'available', source: 'codex', observedAt: 1793200000, checkedAt: 1793200000, planType: 'plus', message: null,
    windows: [{ id: 'codex-primary', label: '5 jam', scope: 'codex', usedPercent, windowDurationMins: 300, resetsAt: 1793300000, remaining: null, limit: null, unit: null }] };
}
it('loads only while visible, deduplicates concurrent reads, polls and stops when closed', async () => {
  vi.useFakeTimers();
  invoke.mockImplementation(async (_command, { profileId }) => usage(profileId));
  const profile = account('visible');
  const { result, rerender, unmount } = renderHook(({ open }) => useProviderUsage([profile], open), { initialProps: { open: false } });
  expect(invoke).not.toHaveBeenCalled();
  rerender({ open: true });
  await act(async () => { await loadProviderUsage(profile); });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(result.current[0].data?.profileId).toBe(profile.id);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  rerender({ open: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  rerender({ open: true });
  await act(async () => {});
  expect(invoke).toHaveBeenCalledTimes(3);
  unmount();
});
it('refreshes on reopen before the regular cache interval, without polling hidden documents', async () => {
  vi.useFakeTimers();
  invoke.mockImplementation(async (_command, { profileId }) => usage(profileId));
  const profile = account('reopen');
  const { rerender, unmount } = renderHook(({ open }) => useProviderUsage([profile], open), { initialProps: { open: true } });
  await act(async () => {});
  rerender({ open: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  rerender({ open: true });
  await act(async () => {});
  expect(invoke).toHaveBeenCalledTimes(2);
  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(invoke).toHaveBeenCalledTimes(3);
  hidden.mockRestore(); unmount();
});
it('keeps late responses scoped to their account and rejects a mismatched response', async () => {
  let resolve!: (data: ProviderUsage) => void;
  invoke.mockImplementation((_command, { profileId }) => profileId === 'slow-usage' ? new Promise((yes) => { resolve = yes; }) : Promise.resolve(usage('other-account')));
  const { result, rerender } = renderHook(({ profile }) => useProviderUsage([profile], true), { initialProps: { profile: account('slow-usage') } });
  rerender({ profile: account('fast-usage') });
  await waitFor(() => expect(result.current[0].error).toContain('belum dapat diperbarui'));
  await act(async () => resolve(usage('slow-usage')));
  expect(result.current[0].profile.id).toBe('fast-usage');
  expect(result.current[0].data).toBeNull();
});
it('retains the previous observation and reports an error on refresh failure', async () => {
  invoke.mockResolvedValueOnce(usage('stale-usage'));
  const profile = account('stale-usage');
  const { result } = renderHook(() => useProviderUsage([profile], true));
  await waitFor(() => expect(result.current[0].data?.windows[0].usedPercent).toBe(25));
  invoke.mockImplementation(async (command) => { if (command === 'list_task_attempts') return []; throw new Error('Offline'); });
  await act(async () => { await refreshUsageAfterTask([profile], 'task', profile); });
  expect(result.current[0].data?.windows[0].usedPercent).toBe(25);
  expect(result.current[0].error).toContain('Coba lagi');
});
it('refreshes selected and fallback accounts after a task, after any older read completes', async () => {
  const a = account('task-a'), b = account('task-b'), unused = account('task-unused');
  let resolve!: (data: ProviderUsage) => void;
  invoke.mockImplementation((command, args) => command === 'list_task_attempts' ? Promise.resolve([{ profileId: b.id }])
    : args.profileId === a.id ? new Promise((yes) => { resolve = yes; }) : Promise.resolve(usage(args.profileId)));
  const before = loadProviderUsage(a);
  const after = refreshUsageAfterTask([a, b, unused], 'task-with-fallback', a);
  await Promise.resolve();
  invoke.mockImplementation(async (command, args) => command === 'list_task_attempts' ? [] : usage(args.profileId, 40));
  resolve(usage(a.id, 10)); await before; await after;
  expect(invoke.mock.calls.filter(([command, args]) => command === 'get_provider_usage' && args.profileId === a.id)).toHaveLength(2);
  expect(invoke).toHaveBeenCalledWith('get_provider_usage', { profileId: b.id });
  expect(invoke).not.toHaveBeenCalledWith('get_provider_usage', { profileId: unused.id });
});
it('accepts real zero and missing windows, rejecting invalid usage data', () => {
  expect(validUsage(usage('valid', 0), 'valid')).toBe(true);
  expect(validUsage({ ...usage('valid'), status: 'unavailable', source: 'none', windows: [], observedAt: null }, 'valid')).toBe(true);
  expect(validUsage(usage('wrong'), 'valid')).toBe(false);
  expect(validUsage(usage('valid', NaN), 'valid')).toBe(false);
  expect(validUsage({ ...usage('valid'), source: 'none' }, 'valid')).toBe(false);
  expect(validUsage({ ...usage('valid'), observedAt: 1e30 }, 'valid')).toBe(false);
  expect(validUsage({ ...usage('valid'), windows: [{ ...usage('valid').windows[0], resetsAt: 1e30 }] }, 'valid')).toBe(false);
});

it('reads usage immediately after access recovers without waiting for the failure cache', async () => {
  const profile = account('access-recovery');
  invoke.mockRejectedValueOnce(new Error('[KEYCHAIN_LOCKED]'));
  const { result } = renderHook(() => useProviderUsage([profile], false));
  await act(async () => { await loadProviderUsage(profile); });
  expect(result.current[0].error).not.toBe('');
  invoke.mockResolvedValueOnce(usage(profile.id, 17));
  await act(async () => { await refreshProviderUsage(profile); });
  expect(result.current[0].error).toBe('');
  expect(result.current[0].data?.windows[0].usedPercent).toBe(17);
  expect(invoke).toHaveBeenCalledTimes(2);
});
