import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AiProviderProfile } from '@forgekit/contracts';
import { useModelSelection, warmModelCatalogs } from './modelCatalog';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('./tauri', () => ({ call: invoke }));
function account(id: string): AiProviderProfile {
  return { id, name: id, providerType: 'openai', model: `${id}-default`, baseUrl: 'https://api.openai.com/v1', keyReference: `key-${id}`, isDefault: false, createdAt: '1', updatedAt: '1' };
}
it('discovers per account, keeps model/effort choices across switches, and resets effort for another model', async () => {
  invoke.mockImplementation(async (_command, { profileId }) => [
    { id: `${profileId}-default`, displayName: 'Default', reasoningEfforts: ['low', 'medium', 'high'] },
    { id: `${profileId}-other`, displayName: 'Other', reasoningEfforts: ['low', 'high'] },
  ]);
  const a = account('switch-a'); const b = account('switch-b');
  const { result, rerender } = renderHook(({ profile }) => useModelSelection(profile), { initialProps: { profile: a } });
  await waitFor(() => expect(result.current.models).toHaveLength(2));
  act(() => result.current.setEffort('high'));
  expect(result.current.provider).toMatchObject({ id: a.id, model: 'switch-a-default', reasoningEffort: 'high' });
  act(() => result.current.setModel('switch-a-other'));
  expect(result.current.effort).toBe('');
  act(() => result.current.setEffort('low'));
  rerender({ profile: b });
  await waitFor(() => expect(result.current.models[0]?.id).toBe('switch-b-default'));
  expect(result.current.provider).toMatchObject({ id: b.id, model: 'switch-b-default', reasoningEffort: undefined });
  rerender({ profile: a });
  expect(result.current.provider).toMatchObject({ id: a.id, model: 'switch-a-other', reasoningEffort: 'low' });
  expect(invoke).toHaveBeenCalledWith('get_provider_model_catalog', { profileId: b.id });
});
it('does not leak a delayed catalog from a previously selected account', async () => {
  let resolve!: (value: unknown) => void;
  invoke.mockImplementation((_command, { profileId }) => profileId === 'slow-a' ? new Promise((yes) => { resolve = yes; }) : Promise.resolve([{ id: 'quick-b-default', displayName: 'B', reasoningEfforts: [] }]));
  const { result, rerender } = renderHook(({ profile }) => useModelSelection(profile), { initialProps: { profile: account('slow-a') } });
  rerender({ profile: account('quick-b') });
  await waitFor(() => expect(result.current.models[0]?.id).toBe('quick-b-default'));
  await act(async () => resolve([{ id: 'slow-a-other', displayName: 'A', reasoningEfforts: ['high'] }]));
  expect(result.current.provider?.id).toBe('quick-b');
  expect(result.current.models[0].id).toBe('quick-b-default');
});
it('keeps the configured model usable on discovery failure and supports explicit refresh', async () => {
  invoke.mockRejectedValueOnce(new Error('Offline'));
  const { result } = renderHook(() => useModelSelection(account('offline')));
  await waitFor(() => expect(result.current.error).toBe('Offline'));
  expect(result.current.provider?.model).toBe('offline-default');
  invoke.mockResolvedValueOnce([{ id: 'new-model', displayName: 'New', reasoningEfforts: [] }]);
  await act(async () => result.current.refresh());
  expect(result.current.error).toBe('');
  expect(result.current.provider).toBeNull();
  expect(result.current.modelId).toBe('offline-default');
  expect(result.current.selectionError).toContain('tidak lagi tersedia');
  act(() => result.current.setModel('new-model'));
  expect(result.current.provider?.model).toBe('new-model');
});

it('refreshes a failed catalog immediately after reconnecting the same stored account', async () => {
  const profile = account('reconnected');
  invoke.mockRejectedValueOnce(new Error('Login expired'));
  const { result } = renderHook(() => useModelSelection(profile));
  await waitFor(() => expect(result.current.error).toBe('Login expired'));
  invoke.mockResolvedValueOnce([{ id: profile.model, displayName: 'Connected model', reasoningEfforts: ['high'] }]);
  act(() => warmModelCatalogs([profile], true));
  await waitFor(() => expect(result.current.selected?.displayName).toBe('Connected model'));
  expect(result.current.error).toBe('');
  expect(result.current.provider?.id).toBe(profile.id);
});

it('requests macOS authorization only on explicit recovery and keeps the same account and model', async () => {
  const profile = account('locked-account');
  invoke.mockRejectedValueOnce(new Error('[KEYCHAIN_LOCKED] Permission required'));
  const { result } = renderHook(() => useModelSelection(profile));
  await waitFor(() => expect(result.current.error).toContain('[KEYCHAIN_LOCKED]'));
  expect(invoke).toHaveBeenLastCalledWith('get_provider_model_catalog', { profileId: profile.id });
  expect(result.current.provider).toBeNull();
  invoke.mockResolvedValueOnce([{ id: profile.model, displayName: 'My model', reasoningEfforts: ['high'] }]);
  await act(async () => result.current.authorize());
  expect(invoke).toHaveBeenCalledWith('get_provider_model_catalog', { profileId: profile.id, authorize: true });
  expect(invoke).toHaveBeenCalledWith('get_provider_usage', { profileId: profile.id });
  expect(result.current.error).toBe('');
  expect(result.current.provider).toMatchObject({ id: profile.id, model: profile.model });
});
