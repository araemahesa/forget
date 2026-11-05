import { useEffect, useSyncExternalStore } from 'react';
import { loadProviderUsage, refreshProviderUsage } from './providerUsage';
import { warmModelCatalogs } from './modelCatalog';
import type {
  AiProviderProfile,
  ConnectionProfile,
  FallbackPolicy,
  RouterConnection,
} from '@forgekit/contracts';
import {
  DEFAULT_9ROUTER_CONNECTION,
  DEFAULT_FALLBACK_POLICY,
  connectionToLegacyProfile,
} from '@forgekit/contracts';
import {
  getFallbackPolicy,
  getRouterConnection,
  listConnectionProfiles,
} from './ai';

type ProviderStoreState = {
  connectionProfiles: ConnectionProfile[];
  profiles: AiProviderProfile[];
  fallbackPolicy: FallbackPolicy;
  routerConnection: RouterConnection;
  error: string;
  loading: boolean;
};

let state: ProviderStoreState = {
  connectionProfiles: [],
  profiles: [],
  fallbackPolicy: DEFAULT_FALLBACK_POLICY,
  routerConnection: DEFAULT_9ROUTER_CONNECTION,
  error: '',
  loading: true,
};

const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

export function refreshProviders(force = false): Promise<void> {
  if (pending) return force ? pending.then(() => refreshProviders(true)) : pending;
  pending = (async () => {
    try {
      const [connections, fallback, router] = await Promise.allSettled([
        listConnectionProfiles(),
        getFallbackPolicy(),
        getRouterConnection(),
      ]);

      if (connections.status === 'rejected') throw connections.reason;
      if (fallback.status === 'rejected') throw fallback.reason;
      if (router.status === 'rejected') throw router.reason;
      let connectionProfiles: ConnectionProfile[] = [];
      if (connections.status === 'fulfilled' && Array.isArray(connections.value)) {
        connectionProfiles = connections.value;
      }

      const profiles = connectionProfiles.filter((p) => p.enabled && p.accessState === 'ready' && p.providerId !== 'local-llm').map(connectionToLegacyProfile);

      const fallbackPolicy =
        fallback.status === 'fulfilled' && fallback.value && Array.isArray(fallback.value.orderedProfileIds) && Array.isArray(fallback.value.allowedProviderIds) ? fallback.value : DEFAULT_FALLBACK_POLICY;
      const routerConnection =
        router.status === 'fulfilled' && router.value ? router.value : DEFAULT_9ROUTER_CONNECTION;

      warmModelCatalogs(profiles, force);
      profiles.forEach((profile) => void (force ? refreshProviderUsage(profile) : loadProviderUsage(profile)));
      state = {
        connectionProfiles,
        profiles,
        fallbackPolicy,
        routerConnection,
        error: '',
        loading: false,
      };
    } catch (err: unknown) {
      state = {
        ...state,
        error: err instanceof Error ? err.message : 'Provider belum dapat dibaca.',
        loading: false,
      };
    } finally {
      pending = null;
      emit();
    }
  })();
  return pending;
}

export function useProviders() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );

  useEffect(() => {
    void refreshProviders();
  }, []);

  const defaultProvider =
    snapshot.profiles.find((profile) => profile.isDefault) ??
    null;

  return {
    connectionProfiles: snapshot.connectionProfiles,
    profiles: snapshot.profiles,
    error: snapshot.error,
    loading: snapshot.loading,
    defaultProvider,
  };
}

export function useConnectionProfiles() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );

  useEffect(() => {
    void refreshProviders();
  }, []);

  const primaryProfile =
    snapshot.connectionProfiles.find((p) => p.isDefault) ??
    null;

  const backupProfiles = snapshot.connectionProfiles
    .filter((p) => p.id !== primaryProfile?.id)
    .sort((a, b) => a.priority - b.priority);

  return {
    profiles: snapshot.connectionProfiles,
    primaryProfile,
    backupProfiles,
    fallbackPolicy: snapshot.fallbackPolicy,
    routerConnection: snapshot.routerConnection,
    loading: snapshot.loading,
    error: snapshot.error,
  };
}
