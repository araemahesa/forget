import { useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { captureStudioContext, probeStudio, readStudio, type StudioReport } from './tauri';
import type { ContextSnapshot } from '@forgekit/contracts';

export type StudioSnapshot = { studio: StudioReport['studios'][number]; checkedAt: string; output?: string; context?: ContextSnapshot };
export type StudioDiscovery = { studios: StudioReport['studios']; status: 'searching' | 'connected' | 'offline' | 'choose' | 'unavailable'; error?: string };
let snapshot: StudioSnapshot | null = null;
let discovery: StudioDiscovery = { studios: [], status: 'searching' };
let selectedId: string | null = null;
let inFlight: Promise<StudioSnapshot | null> | null = null;
let inFlightRevision = -1;
let tasks = 0;
let generation = 0;
let polling = false;
let pollToken = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach((listener) => listener());
// The map last used is reconnected automatically after a restart; it is matched by place, not by
// the per-session instance ID.
const rememberedKey = 'forgekit:studio-target';
type Remembered = { name: string; placeId: string };
const placeKey = (studio: StudioReport['studios'][number]) => String(studio.placeId ?? '');
function remembered(): Remembered | null {
  try { const value = JSON.parse(localStorage.getItem(rememberedKey) ?? 'null'); return value && typeof value.name === 'string' && typeof value.placeId === 'string' ? value : null; } catch { return null; }
}
function remember(studio: StudioReport['studios'][number]) {
  try { localStorage.setItem(rememberedKey, JSON.stringify({ name: studio.name, placeId: placeKey(studio) })); } catch { /* Memory only. */ }
}
/** Picks the target without asking: the chosen instance, else the map used last, else the first open map. */
export function autoTarget(studios: StudioReport['studios'], chosen: string | null): StudioReport['studios'][number] | null {
  const usable = studios.filter((studio) => studio.name.trim() && !studio.verificationError);
  const last = remembered();
  return usable.find((s) => s.studioId === chosen)
    ?? (last ? usable.find((s) => placeKey(s) === last.placeId && s.name === last.name) ?? usable.find((s) => last.placeId !== '' && placeKey(s) === last.placeId) : undefined)
    ?? usable[0] ?? null;
}
export function setStudioSnapshot(value: StudioSnapshot | null) { snapshot = value; notify(); }
export function getStudioSnapshot() { return snapshot; }
export function useStudioSnapshot() { return useSyncExternalStore(subscribe, () => snapshot); }
export function useStudioDiscovery() { return useSyncExternalStore(subscribe, () => discovery); }
export function selectStudioTarget(id: string) {
  if (!discovery.studios.some((studio) => studio.studioId === id) || tasks) return;
  selectedId = id; generation++; setStudioSnapshot(null);
  const chosen = discovery.studios.find((studio) => studio.studioId === id);
  if (chosen) remember(chosen);
  void refreshStudioContext();
}
export function acquireStudioTask() { tasks++; let released = false; return () => { if (!released) { released = true; tasks--; } }; }
export function refreshStudioContext(): Promise<StudioSnapshot | null> {
  if (!isTauri()) return Promise.resolve(snapshot);
  if (inFlight) {
    if (inFlightRevision === generation) return inFlight;
    // A probe from an older generation discards its result; probe again once it settles.
    return inFlight.then(() => refreshStudioContext(), () => refreshStudioContext());
  }
  const revision = generation;
  inFlightRevision = revision;
  inFlight = (async () => {
    try {
      const report = await probeStudio();
      if (revision !== generation) return snapshot;
      const target = autoTarget(report.studios, selectedId);
      discovery = { studios: report.studios, status: target ? 'connected' : report.studios.length ? 'choose' : 'offline' };
      if (!target) { selectedId = null; setStudioSnapshot(null); return null; }
      if (tasks && snapshot) {
        const unchanged = snapshot.studio.studioId === target.studioId && snapshot.studio.placeId === target.placeId
          && snapshot.studio.name === target.name && JSON.stringify(snapshot.studio.target) === JSON.stringify(target.target);
        if (unchanged) return snapshot;
        generation++; selectedId = null; setStudioSnapshot(null); return null;
      }
      if (!target.name.trim() || target.verificationError) { setStudioSnapshot(null); return null; }
      if (!target.target) {
        const verified = await readStudio(target.studioId, 'get_studio_state') as { isError?: boolean };
        if (!verified || verified.isError) { setStudioSnapshot(null); return null; }
      }
      if (revision !== generation) return snapshot;
      selectedId = target.studioId;
      remember(target);
      // Never retain another map's hierarchy when a target disappears or changes.
      snapshot = { studio: target, checkedAt: report.checkedAt };
      notify();
      try {
        const context = await captureStudioContext(target.studioId, 'game', 3);
        if (revision === generation && selectedId === target.studioId) setStudioSnapshot({ studio: target, checkedAt: context.observedAt, context });
      } catch (failure) {
        // Live tools can still operate if this Studio version has no bounded tree adapter.
        if (revision === generation) { discovery = { ...discovery, error: failure instanceof Error ? failure.message : 'Hierarki belum tersedia.' }; notify(); }
      }
      return snapshot;
    } catch (failure) {
      if (revision === generation) { discovery = { studios: [], status: 'unavailable', error: failure instanceof Error ? failure.message : 'Studio belum tersedia.' }; selectedId = null; setStudioSnapshot(null); }
      return null;
    } finally { inFlight = null; }
  })();
  return inFlight;
}
export function startStudioDiscovery() {
  if (!isTauri() || polling) return () => {};
  polling = true;
  // Each start owns its loop; a tick resuming after a StrictMode stop/start must not spawn a second loop.
  const token = ++pollToken;
  async function tick() {
    if (token !== pollToken) return;
    // Active jobs own the pinned target and MCP session, including verification.
    if (!tasks) await refreshStudioContext();
    if (token === pollToken) timer = setTimeout(() => void tick(), 8000);
  }
  void tick();
  return () => {
    if (token !== pollToken) return;
    polling = false; pollToken++; generation++; clearTimeout(timer);
  };
}
