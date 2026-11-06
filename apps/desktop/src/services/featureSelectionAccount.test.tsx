import { renderHook, act } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AiProviderProfile } from '@forgekit/contracts';
const store = vi.hoisted(() => ({ profiles: [] as AiProviderProfile[], defaultProvider: null as AiProviderProfile | null, loading: false }));
vi.mock('./providerState', () => ({ useProviders: () => ({ ...store, connectionProfiles: [] }), refreshProviders: vi.fn() }));
vi.mock('./modelCatalog', () => ({ useModelSelection: (p: AiProviderProfile | null) => ({ provider: p, modelId: p?.model ?? '', effort: '' }) }));
import { clearFeatureChoice, getFeatureChoice, setFeatureChoice, useFeatureProviderSelection } from './featureSelection';
const a = { id: 'a', model: 'a-model', isDefault: true } as AiProviderProfile;
const b = { id: 'b', model: 'b-model', isDefault: false } as AiProviderProfile;
beforeEach(() => { clearFeatureChoice('account-test'); store.profiles = [a, b]; store.defaultProvider = a; store.loading = false; });
it('pins legacy inheritance once and does not follow later primary changes', () => {
  const { result, rerender } = renderHook(() => useFeatureProviderSelection('account-test'));
  expect(getFeatureChoice('account-test')).toBe('a');
  expect(result.current.snapshot().providerId).toBe('a');
  store.defaultProvider = b; rerender();
  expect(result.current.choice).toBe('a');
  act(() => result.current.setChoice('b'));
  expect(result.current.snapshot()).toMatchObject({ choice: 'b', providerId: 'b', modelId: 'b-model' });
});
it('requires an explicit choice if a saved account is unavailable', () => {
  setFeatureChoice('account-test', 'removed-account');
  const { result } = renderHook(() => useFeatureProviderSelection('account-test'));
  expect(result.current.effectiveAccount).toBeNull();
  expect(result.current.fallbackNotice).toContain('Pilih akun lain');
  expect(result.current.snapshot().providerId).toBeNull();
});

it('does not report a saved account as unavailable while providers are still loading', () => {
  setFeatureChoice('account-test', 'b');
  store.profiles = []; store.defaultProvider = null; store.loading = true;
  const { result, rerender } = renderHook(() => useFeatureProviderSelection('account-test'));
  expect(result.current.fallbackNotice).toBe('');
  store.profiles = [a, b]; store.defaultProvider = a; store.loading = false; rerender();
  expect(result.current.fallbackNotice).toBe('');
  expect(result.current.effectiveAccount?.id).toBe('b');
});
