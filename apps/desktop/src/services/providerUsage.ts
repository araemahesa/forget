import { useEffect, useSyncExternalStore } from 'react';
import type { AiProviderProfile } from '@forgekit/contracts';
import { call } from './tauri';
export type UsageWindow = { id: string; label: string; scope: string; usedPercent: number; windowDurationMins: number | null; resetsAt: number | null; remaining: number | null; limit: number | null; unit: string | null };
export type ProviderUsage = { profileId: string; status: 'available' | 'unavailable'; source: 'codex' | 'provider_api' | 'google_monitoring' | 'router_api' | 'api_headers' | 'none'; observedAt: number | null; checkedAt: number; planType: string | null; windows: UsageWindow[]; message: string | null };
type Entry = { data: ProviderUsage | null; loading: boolean; error: string; fetchedAt: number };
const empty: Entry = { data: null, loading: false, error: '', fetchedAt: 0 };
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
// The native usage command reads the saved account by ID; a task model override does not create another quota account.
const keyOf = (p: AiProviderProfile) => JSON.stringify([p.id, p.providerType, p.baseUrl, p.keyReference, p.updatedAt]);
function emit() { revision++; listeners.forEach((fn) => fn()); }
export function validUsage(data: ProviderUsage, id: string): boolean {
  return !!data && data.profileId === id && ['available', 'unavailable'].includes(data.status) && Array.isArray(data.windows) && data.windows.length <= 48
    && ['codex', 'provider_api', 'google_monitoring', 'router_api', 'api_headers', 'none'].includes(data.source) && Number.isFinite(data.checkedAt) && data.checkedAt > 0
    && (data.message == null || typeof data.message === 'string') && (data.planType == null || typeof data.planType === 'string')
    && data.windows.every((w) => w && typeof w.id === 'string' && typeof w.label === 'string' && typeof w.scope === 'string' && Number.isFinite(w.usedPercent) && w.usedPercent >= 0
      && (w.windowDurationMins == null || (Number.isFinite(w.windowDurationMins) && w.windowDurationMins > 0))
      && (w.remaining == null || (Number.isFinite(w.remaining) && w.remaining >= 0))
      && (w.limit == null || (Number.isFinite(w.limit) && w.limit > 0)) && (w.unit == null || typeof w.unit === 'string')
      && (w.resetsAt == null || (Number.isFinite(w.resetsAt) && w.resetsAt > 0 && w.resetsAt <= 8_640_000_000_000)))
    && (data.status !== 'available' || (data.source !== 'none' && !!data.windows.length && Number.isFinite(data.observedAt) && data.observedAt! > 0 && data.observedAt! <= 8_640_000_000_000));
}
export function loadProviderUsage(profile: AiProviderProfile, force = false): Promise<void> {
  const key = keyOf(profile);
  if (pending.has(key)) return pending.get(key)!;
  const previous = entries.get(key) ?? empty;
  if (previous.fetchedAt && Date.now() - previous.fetchedAt < (force ? 5_000 : 30_000)) return Promise.resolve();
  entries.set(key, { ...previous, loading: true, error: '' }); emit();
  const request = (async () => {
    try {
      const data = await call<ProviderUsage>('get_provider_usage', { profileId: profile.id });
      if (!validUsage(data, profile.id)) throw new Error('Data usage akun belum dapat diverifikasi.');
      entries.set(key, { data, loading: false, error: '', fetchedAt: Date.now() });
    } catch {
      entries.set(key, { ...previous, loading: false, error: 'Usage belum dapat diperbarui. Coba lagi.', fetchedAt: Date.now() });
    } finally { pending.delete(key); emit(); }
  })();
  pending.set(key, request);
  return request;
}
export function useProviderUsage(profiles: AiProviderProfile[], active: boolean) {
  useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => revision);
  const keys = profiles.map(keyOf).join('\n');
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') profiles.forEach((p) => void loadProviderUsage(p)); };
    if (document.visibilityState !== 'hidden') profiles.forEach((p) => void loadProviderUsage(p, true));
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [keys, active]);
  return profiles.map((p) => ({ profile: p, ...(entries.get(keyOf(p)) ?? empty) }));
}
/** Update only accounts used by this task, without opening a usage panel. */
export async function refreshUsageAfterTask(profiles: AiProviderProfile[], taskId: string, selected: AiProviderProfile) {
  const ids = new Set([selected.id]);
  try {
    const attempts = await call<{ profileId: string }[]>('list_task_attempts', { taskId });
    if (Array.isArray(attempts)) attempts.forEach((attempt) => ids.add(attempt.profileId));
  } catch { /* Still refresh the selected account when attempt history is unavailable. */ }
  await Promise.all([...ids].map(async (id) => {
    const profile = id === selected.id ? selected : profiles.find((p) => p.id === id);
    if (!profile) return;
    const key = keyOf(profile);
    // A read started before completion must finish before the new observation.
    await pending.get(key);
    const entry = entries.get(key);
    if (entry) entries.set(key, { ...entry, fetchedAt: 0 });
    await loadProviderUsage(profile);
  }));
}

/** Refresh after connection or credential recovery, including a recent failed read. */
export async function refreshProviderUsage(profile: AiProviderProfile) {
  const key = keyOf(profile);
  await pending.get(key);
  const entry = entries.get(key);
  if (entry) entries.set(key, { ...entry, fetchedAt: 0 });
  await loadProviderUsage(profile);
}
