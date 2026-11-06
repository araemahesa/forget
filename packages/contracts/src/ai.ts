export type AiProviderType = 'openai' | 'openai-compatible' | 'anthropic' | 'gemini' | '9router' | 'local-llm';

export type AiProviderProfile = {
  id: string;
  name: string;
  providerType: AiProviderType;
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  keyReference: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatThread = {
  id: string;
  title: string;
  providerId?: string;
  model: string;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  sequence: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: Record<string, unknown>[];
  toolResults?: Record<string, unknown>[];
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  createdAt: string;
};

export type ChatTurn = {
  id: string;
  kind: 'chat';
  threadId: string;
  prompt: string;
  mode: 'auto' | 'ask' | 'plan';
  studioId?: string;
  contextSnapshotId?: string;
  provider: { profileId: string; adapterId: AiProviderType; modelId: string; endpoint: string; reasoningEffort?: string };
  status: 'queued' | 'planning' | 'reading_context' | 'streaming' | 'tool_running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  toolResults?: SnapshotToolReceipt[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  events: { sequence: number; stage: ChatTurn['status']; createdAt: string }[];
};

export type SnapshotNodeReference = {
  reference: string;
  name: string;
  className: string;
  childCount: number;
};

export type SnapshotToolReceipt = {
  callId: string;
  name: 'map.search' | 'map.inspect';
  implementationVersion: '1.0.0';
  snapshotId: string;
  contentHash: string;
  requestHash: string;
  observedAt: string;
  completedAt: string;
  readOnly: true;
  truncated: boolean;
  matches: SnapshotNodeReference[];
};

export function validateSnapshotToolReceipt(value: unknown): value is SnapshotToolReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const fields = ['callId', 'name', 'implementationVersion', 'snapshotId', 'contentHash', 'requestHash', 'observedAt', 'completedAt', 'readOnly', 'truncated', 'matches'];
  if (Object.keys(v).length !== fields.length || fields.some((field) => !(field in v))) return false;
  const label = (v: unknown, limit: number) => typeof v === 'string' && !!v.trim() && v.length <= limit && !/[\u0000-\u001f\u007f]/.test(v);
  if (!label(v.callId, 128) || !label(v.snapshotId, 128) || !['map.search', 'map.inspect'].includes(String(v.name))
    || v.implementationVersion !== '1.0.0' || v.readOnly !== true || typeof v.truncated !== 'boolean') return false;
  if (!['contentHash', 'requestHash'].every((key) => typeof v[key] === 'string' && /^[a-f0-9]{64}$/.test(v[key] as string))
    || !['observedAt', 'completedAt'].every((key) => typeof v[key] === 'string' && /^\d{1,20}$/.test(v[key] as string))) return false;
  return Array.isArray(v.matches) && v.matches.length <= 300 && v.matches.every((node: unknown) => {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    return Object.keys(n).length === 4 && typeof n.reference === 'string' && n.reference.length <= 128 && /^node(?:\/\d+){1,12}$/.test(n.reference)
      && label(n.name, 512) && label(n.className, 512) && Number.isInteger(n.childCount) && (n.childCount as number) >= 0 && (n.childCount as number) <= 300;
  });
}

export type ProviderTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
  modelCount?: number;
};

export type McpConnectorConfig = {
  id: string;
  name: string;
  transport: 'stdio';
  /** Executable started over stdio: a bare name on PATH (e.g. `npx`) or an absolute path. */
  command: string;
  args: string[];
  isEnabled: boolean;
  /** Empty means every tool the server lists. */
  allowedTools: string[];
  createdAt: string;
  updatedAt: string;
};

export type McpToolInfo = {
  name: string;
  description: string;
  category: string;
  isWrite: boolean;
};

export type ConnectionMode = 'direct' | 'router';
export type CredentialOwner = 'forgekit' | 'router';
export type Support = 'supported' | 'unsupported' | 'unknown';
export type AccessState = 'pending' | 'ready' | 'identity_only' | 'reauth_required' | 'revoked';

export type ConnectionIdentity = {
  issuer: string;
  subject: string;
  tenantId?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

export type ConnectionProfile = {
  id: string;
  providerId: string;
  connectionMode: ConnectionMode;
  credentialOwner: CredentialOwner;
  routerInstanceId?: string;
  upstreamConnectionRef?: string;
  authMethod: string;
  label: string;
  identity?: ConnectionIdentity;
  registrationRef?: string;
  credentialRef?: string;
  accessState: AccessState;
  enabled: boolean;
  fallbackEligible: Support;
  fallbackDisabledReason?: string;
  priority: number;
  quotaBucketRefs: string[];
  baseUrl: string;
  model: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FallbackPolicy = {
  id: string;
  enabled: boolean;
  orderedProfileIds: string[];
  allowedProviderIds: string[];
  allowCrossProvider: boolean;
  allowModelChange: boolean;
  routingOwner: 'forgekit' | 'router';
  maxAttempts: number;
  maxElapsedMs: number;
  budgetPolicyId?: string;
  dataPolicyId?: string;
};

export type RouterConnection = {
  id: string;
  kind: '9router';
  baseUrl: string;
  dashboardUrl?: string;
  inferenceCredentialRef: string;
  managementCredentialRef?: string;
  detectedVersion?: string;
  managementAccess: 'available' | 'unavailable' | 'unknown';
  routingOwner: 'router' | 'forgekit';
  lastVerifiedAt?: string;
};

export type RouterProbe = { models: string[]; detectedVersion?: string; managementAccess: 'unavailable' | 'unknown'; upstreamState: 'unknown'; message: string };
export type ProviderConnectSession = { sessionId: string; providerId: string; mode: 'direct' | 'router'; authUrl: string; status: string; expiresAt: string; message?: string };
export type TaskActivity = { taskId: string; revision: number } & ({ type: 'progress' | 'candidate'; stage: 'planning' | 'reading_context' | 'streaming' | 'validating' | 'repairing' | 'saving' | 'unknown' } | { type: 'final'; stored: true } | { type: 'needs_action'; action: 'stop_play'; message: string } | { type: 'error'; category: string; message: string });
export type ProviderCatalogEntry = { id: string; name: string; badge?: string; description: string; path: ConnectionMode; upstreamStatus: 'official' | 'third_party' | 'deprecated'; riskNotice?: string; authMethods: string[]; capabilities: Record<string, Support> };
export { validateTaskActivity, connectionToLegacyProfile, DEFAULT_PROVIDER_CATALOG, DEFAULT_FALLBACK_POLICY, DEFAULT_9ROUTER_CONNECTION } from './context-runtime.js';
