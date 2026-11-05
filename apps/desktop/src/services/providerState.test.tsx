import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '@forgekit/contracts';
import { DEFAULT_9ROUTER_CONNECTION, DEFAULT_FALLBACK_POLICY } from '@forgekit/contracts';
import { refreshProviders, useProviders } from './providerState';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('./tauri', () => ({ call: invoke }));

it('automatically loads models and usage for newly added accounts without authorization IPC', async () => {
  let accounts: ConnectionProfile[] = [];
  invoke.mockImplementation(async (command, args) => {
    if (command === 'list_connection_profiles') return accounts;
    if (command === 'get_fallback_policy') return DEFAULT_FALLBACK_POLICY;
    if (command === 'get_router_connection') return DEFAULT_9ROUTER_CONNECTION;
    if (command === 'get_provider_model_catalog') return [{ id: 'fixture-model', displayName: 'Fixture', reasoningEfforts: [] }];
    if (command === 'get_provider_usage') return { profileId: args.profileId, status: 'unavailable', source: 'none', observedAt: null, checkedAt: 1793200000, planType: null, windows: [], message: 'Provider does not expose quota.' };
    throw new Error(`Unexpected command: ${command}`);
  });
  const { result } = renderHook(() => useProviders());
  await waitFor(() => expect(result.current.loading).toBe(false));
  accounts = ['openai', 'claude', 'google-gemini', 'antigravity-9router'].map((providerId, i) => ({
    id: `auto-account-${i}`, providerId, connectionMode: 'direct', credentialOwner: 'forgekit',
    authMethod: 'api_key', label: 'New account', credentialRef: `fixture-key-${i}`, accessState: 'ready',
    enabled: true, fallbackEligible: 'unknown', priority: i, quotaBucketRefs: [`fixture-${i}`],
    baseUrl: 'https://example.test/v1', model: 'fixture-model', isDefault: i === 0, createdAt: '1', updatedAt: '1',
  }));
  await act(async () => { await refreshProviders(true); });
  expect(result.current.profiles).toHaveLength(4);
  for (const account of accounts) {
    expect(invoke).toHaveBeenCalledWith('get_provider_model_catalog', { profileId: account.id });
    expect(invoke).toHaveBeenCalledWith('get_provider_usage', { profileId: account.id });
    expect(invoke).not.toHaveBeenCalledWith('get_provider_model_catalog', { profileId: account.id, authorize: true });
  }
  await act(async () => { await refreshProviders(true); });
  for (const account of accounts) {
    expect(invoke.mock.calls.filter(([command, args]) => command === 'get_provider_usage' && args.profileId === account.id)).toHaveLength(2);
  }
});
