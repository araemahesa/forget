import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { AiProviderProfile, ConnectionProfile } from '@forgekit/contracts';
import { refreshProviders, useProviders } from './providerState';
import { useModelSelection } from './modelCatalog';
import { setPrimaryProfile } from './ai';

export type FeatureChoice = 'inherit' | 'local' | string;

export type FeatureChoiceSnapshot = {
  featureKey: string;
  choice: FeatureChoice;
  providerId: string | null;
  providerType: string | null;
  modelId: string;
  reasoningEffort?: string;
  isLocal: boolean;
  capturedAt: number;
};

const storageKey = (featureKey: string) => `forgekit:feature-provider-choice:${featureKey}`;
const memoryChoices = new Map<string, FeatureChoice>();
const listeners = new Set<() => void>();
let revision = 0;

function emit() {
  revision++;
  listeners.forEach((listener) => listener());
}

export function getFeatureChoice(featureKey: string): FeatureChoice {
  if (memoryChoices.has(featureKey)) {
    return memoryChoices.get(featureKey)!;
  }
  try {
    const saved = localStorage.getItem(storageKey(featureKey));
    if (saved && typeof saved === 'string') {
      memoryChoices.set(featureKey, saved);
      return saved;
    }
  } catch {
    // LocalStorage fallback to in-memory store
  }
  return 'inherit';
}

export function setFeatureChoice(featureKey: string, choice: FeatureChoice) {
  memoryChoices.set(featureKey, choice);
  try {
    localStorage.setItem(storageKey(featureKey), choice);
  } catch {
    // Memory fallback
  }
  emit();
}

/** Explicit selection for new tasks; running tasks retain their captured account. */
export function selectAccountForFeatures(id: string) {
  const keys = new Set(['chat', 'model3d', 'animation', 'vfx', 'sky', 'interface', 'npc', 'cutscene', 'material', 'music', 'gfx', 'icon', 'clothing', 'texture', 'sfx', ...memoryChoices.keys()]);
  for (const key of keys) setFeatureChoice(key, id);
}

export function clearFeatureChoice(featureKey: string) {
  memoryChoices.delete(featureKey);
  try {
    localStorage.removeItem(storageKey(featureKey));
  } catch {
    // Memory fallback
  }
  emit();
}

export function useFeatureProviderSelection(featureKey: string) {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
  );

  const { profiles = [], defaultProvider, connectionProfiles = [], loading: providersLoading } = useProviders();
  const primaryProfile =
    connectionProfiles.find((p) => p.isDefault) ??
    null;
  const rawChoice = getFeatureChoice(featureKey);

  const [fallbackNotice, setFallbackNotice] = useState<string>('');

  // Migrate the old inherited preference once; later primary changes must not switch this feature's account.
  const choice = rawChoice === 'inherit' ? defaultProvider?.id ?? '' : rawChoice;
  useEffect(() => {
    if (!providersLoading && rawChoice === 'inherit' && defaultProvider) {
      setFeatureChoice(featureKey, defaultProvider.id);
    }
  }, [featureKey, rawChoice, providersLoading, defaultProvider?.id]);
  const isInherited = false;
  const isCustomOverride = !!choice && choice !== primaryProfile?.id;
  const effectiveAccount: AiProviderProfile | null = profiles.find((p) => p.id === choice) ?? null;
  const invalidChoice = !!choice && !effectiveAccount;
  useEffect(() => {
    setFallbackNotice(invalidChoice ? 'Akun pilihan sebelumnya tidak tersedia. Pilih akun lain untuk tugas baru.' : '');
  }, [invalidChoice]);

  const effectiveConnection: ConnectionProfile | null = effectiveAccount
    ? connectionProfiles.find((c) => c.id === effectiveAccount.id) ?? null
    : null;

  const modelSelection = useModelSelection(effectiveAccount);

  const handleSetChoice = useCallback(
    (newChoice: FeatureChoice) => {
      setFallbackNotice('');
      setFeatureChoice(featureKey, newChoice);
    },
    [featureKey],
  );

  const promoteToPrimary = useCallback(async () => {
    if (!effectiveAccount) return;
    try {
      await setPrimaryProfile(effectiveAccount.id);
      await refreshProviders();
      handleSetChoice(effectiveAccount.id);
    } catch {
      // Error handling managed by caller or providerState
    }
  }, [effectiveAccount, handleSetChoice]);

  const snapshot = useCallback((): FeatureChoiceSnapshot => {
    return {
      featureKey,
      choice,
      providerId: effectiveAccount?.id ?? null,
      providerType: effectiveAccount?.providerType ?? null,
      modelId: modelSelection.modelId,
      reasoningEffort: modelSelection.effort || undefined,
      isLocal: false,
      capturedAt: Date.now(),
    };
  }, [featureKey, choice, effectiveAccount, modelSelection.modelId, modelSelection.effort]);

  return {
    featureKey,
    choice,
    rawChoice,
    isInherited,
    isCustomOverride,
    isLocal: false,
    effectiveAccount,
    effectiveConnection,
    modelSelection,
    provider: modelSelection.provider,
    profiles,
    connectionProfiles,
    primaryProfile,
    defaultProvider,
    fallbackNotice,

    setChoice: handleSetChoice,
    promoteToPrimary,
    snapshot,
  };
}
