import type { AiProviderProfile, ConnectionProfile, FallbackPolicy, RouterConnection, ProviderCatalogEntry, SnapshotToolReceipt, TaskActivity } from './ai';
export function validateSnapshotToolReceipt(input: unknown): input is SnapshotToolReceipt;
export function connectionToLegacyProfile(profile: ConnectionProfile): AiProviderProfile;
export const DEFAULT_PROVIDER_CATALOG: ProviderCatalogEntry[];
export const DEFAULT_FALLBACK_POLICY: FallbackPolicy;
export const DEFAULT_9ROUTER_CONNECTION: RouterConnection;
export function validateTaskActivity(input: unknown): input is TaskActivity;
