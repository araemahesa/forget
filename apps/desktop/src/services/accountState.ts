import { useEffect, useSyncExternalStore } from 'react';
import { call } from './tauri';
export type DiscordProfile = { id: string; username: string; displayName: string; avatarUrl: string | null };
export type DiscordAccount = { clientId: string | null; redirectUri: string; profile: DiscordProfile | null };
const empty: DiscordAccount = { clientId: null, redirectUri: 'http://127.0.0.1:38473/auth/callback', profile: null };
let state = { account: empty, loading: true, error: '' };
let pending: Promise<void> | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export function setDiscordAccount(account: DiscordAccount) { state = { account, loading: false, error: '' }; loaded = true; emit(); }
export function refreshDiscordAccount() {
  if (pending) return pending;
  pending = call<DiscordAccount>('get_discord_account', {}).then((account) => {
    if (account) setDiscordAccount(account);
  }).catch((error: unknown) => { state = { ...state, loading: false, error: error instanceof Error ? error.message : 'Profil belum dapat dibaca.' }; }).finally(() => { loaded = true; pending = null; emit(); });
  return pending;
}
export const configureDiscord = async (clientId: string) => setDiscordAccount(await call<DiscordAccount>('configure_discord', { clientId }));
export const loginDiscord = async () => setDiscordAccount(await call<DiscordAccount>('login_discord', {}));
export const logoutDiscord = async () => setDiscordAccount(await call<DiscordAccount>('logout_discord', {}));
export function useDiscordAccount() {
  const snapshot = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
  useEffect(() => { if (!loaded) void refreshDiscordAccount(); }, []);
  return snapshot;
}
