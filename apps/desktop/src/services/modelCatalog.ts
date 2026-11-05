import { useEffect, useSyncExternalStore } from 'react';
import type { AiProviderProfile } from '@forgekit/contracts';
import { call } from './tauri';
import { refreshProviderUsage } from './providerUsage';

export type ProviderModel = {
  id: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort?: string | null;
  toolCalling?: 'supported' | 'unsupported' | 'unknown';
};
type Catalog = { models: ProviderModel[]; loading: boolean; error: string; loadedAt: number };
type Selection = { model: string; effort: string };
const empty: Catalog = { models: [], loading: false, error: '', loadedAt: 0 };
const catalogs = new Map<string, Catalog>();
const selections = new Map<string, Selection>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
function emit() { revision++; listeners.forEach((listener) => listener()); }
const keyOf = (profile: AiProviderProfile) => JSON.stringify([profile.id, profile.providerType, profile.baseUrl, profile.keyReference, profile.updatedAt]);
const storageKey = (profile: AiProviderProfile) => `forgekit:model-selection:${profile.id}`;
function savedSelection(profile: AiProviderProfile): Selection {
  const key = keyOf(profile);
  if (!selections.has(key)) {
    let selection = { model: profile.model, effort: '' };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(profile)) ?? 'null');
      if (typeof saved?.model === 'string' && typeof saved?.effort === 'string') selection = saved;
    } catch { /* Storage may be unavailable; selection remains in memory. */ }
    selections.set(key, selection);
  }
  return selections.get(key)!;
}
export function loadModelCatalog(profile: AiProviderProfile, force = false, authorize = false): Promise<void> {
  const key = keyOf(profile);
  if (pending.has(key)) return pending.get(key)!;
  const previous = catalogs.get(key) ?? empty;
  if (!force && previous.loadedAt && Date.now() - previous.loadedAt < 300_000) return Promise.resolve();
  catalogs.set(key, { ...previous, loading: true, error: '' }); emit();
  const request = (async () => {
    try {
      const models = await call<ProviderModel[]>('get_provider_model_catalog', { profileId: profile.id, ...(authorize ? { authorize: true } : {}) });
      if (!Array.isArray(models) || !models.length || models.some((m) => !m || typeof m.id !== 'string' || typeof m.displayName !== 'string' || !Array.isArray(m.reasoningEfforts))) throw new Error('Daftar model belum tersedia dari provider.');
      catalogs.set(key, { models, loading: false, error: '', loadedAt: Date.now() });
      if (authorize) await refreshProviderUsage(profile);
    } catch (error) {
      catalogs.set(key, { ...previous, loading: false, error: error instanceof Error ? error.message : 'Daftar model belum dapat dibaca.', loadedAt: Date.now() });
    } finally { pending.delete(key); emit(); }
  })();
  pending.set(key, request);
  return request;
}
export function warmModelCatalogs(profiles: AiProviderProfile[], force = false) {
  for (const profile of profiles) void loadModelCatalog(profile, force);
}
export function useModelSelection(profile: AiProviderProfile | null | undefined) {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => revision);
  const key = profile ? keyOf(profile) : '';
  useEffect(() => { if (profile) void loadModelCatalog(profile); }, [key]);
  const catalog = (profile && catalogs.get(key)) || empty;
  const requested = profile ? savedSelection(profile) : { model: '', effort: '' };
  const selected = catalog.models.find((m) => m.id === requested.model);
  const modelId = requested.model;
  const invalidModel = catalog.models.length > 0 && !selected;
  const invalidEffort = !!requested.effort && !!selected && !selected.reasoningEfforts.includes(requested.effort);
  const selectionError = invalidModel ? 'Model pilihan tidak lagi tersedia. Pilih model lain secara eksplisit.' : invalidEffort ? 'Penalaran pilihan tidak didukung model ini. Pilih pengaturan lain.' : '';
  const effort = requested.effort;
  const update = (model: string, reasoning: string) => {
    if (!profile) return;
    const next = { model, effort: reasoning };
    selections.set(key, next);
    try { localStorage.setItem(storageKey(profile), JSON.stringify(next)); } catch { /* Memory fallback. */ }
    emit();
  };
  return {
    ...catalog, modelId, effort, selected, account: profile, selectionError,
    provider: profile && !catalog.loading && !catalog.error.includes('KEYCHAIN_LOCKED') && !selectionError ? { ...profile, model: modelId, reasoningEffort: effort || undefined } : null,
    setModel: (model: string) => update(model, ''),
    setEffort: (value: string) => update(modelId, value),
    authorize: () => profile ? loadModelCatalog(profile, true, true) : Promise.resolve(),
    refresh: () => profile ? loadModelCatalog(profile, true) : Promise.resolve(),
  };
}
