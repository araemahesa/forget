import type {
  AiProviderProfile,
  ChatMessage,
  ChatThread,
  ChatTurn,
  ConnectionProfile,
  FallbackPolicy,
  McpConnectorConfig,
  McpToolInfo,
  ProviderConnectSession,
  ProviderTestResult,
  RouterConnection,
  RouterProbe,
} from '@forgekit/contracts';
import { call } from './tauri';

export const listAiProviders = () => call<AiProviderProfile[]>('list_ai_providers', {});
export const saveAiProvider = (profile: AiProviderProfile, secret?: string) =>
  call<void>('save_ai_provider', { profile, secret });
export const deleteAiProvider = (id: string) =>
  call<void>('delete_ai_provider', { id });
export const testAiProvider = (profile: AiProviderProfile) =>
  call<ProviderTestResult>('test_ai_provider', { profile });

export const listConnectionProfiles = () => call<ConnectionProfile[]>('list_connection_profiles', {});
export const saveConnectionProfile = (profile: ConnectionProfile, secret?: string) =>
  call<void>('save_connection_profile', { profile, secret });
export const deleteConnectionProfile = (id: string) =>
  call<void>('delete_connection_profile', { id });
export const setPrimaryProfile = (id: string) =>
  call<void>('set_primary_profile', { id });
export const getFallbackPolicy = () => call<FallbackPolicy>('get_fallback_policy', {});
export const saveFallbackPolicy = (policy: FallbackPolicy) =>
  call<void>('save_fallback_policy', { policy });
export const getRouterConnection = () => call<RouterConnection>('get_router_connection', {});
export const saveRouterConnection = (router: RouterConnection, secret?: string) =>
  call<void>('save_router_connection', { router, secret });
export const testRouterConnection = (router: RouterConnection) =>
  call<ProviderTestResult>('test_router_connection', { router });
export const testConnectionProfile = (profile: ConnectionProfile) =>
  call<ProviderTestResult>('test_connection_profile', { profile });
export const connectProviderBrowser = (providerId: string, routerBaseUrl?: string, sessionId?: string) =>
  call<ProviderConnectSession>('connect_provider_browser', { providerId, routerBaseUrl, sessionId });
export const cancelProviderBrowser = (sessionId: string) => call<void>('cancel_provider_browser', { sessionId });



export const listChatThreads = () => call<ChatThread[]>('list_chat_threads', {});
export const createChatThread = (title: string, model: string, providerId?: string, systemPrompt?: string) =>
  call<ChatThread>('create_chat_thread', { title, model, providerId, systemPrompt });
export const renameChatThread = (id: string, title: string) =>
  call<void>('rename_chat_thread', { id, title });
export const deleteChatThread = (id: string) => call<void>('delete_chat_thread', { id });
export const loadChatThread = (threadId: string) =>
  call<ChatMessage[]>('load_chat_thread', { threadId });
export const latestChatTurn = (threadId: string) =>
  call<ChatTurn | null>('latest_chat_turn', { threadId });
export const sendChatMessage = (threadId: string, userContent: string, provider: AiProviderProfile, requestId: string, mode: 'auto' | 'ask' | 'plan', contextSnapshotId?: string, studioId?: string, referenceImages?: import('./references').ReferenceImage[]) =>
  call<ChatMessage>('send_chat_message', { threadId, userContent, provider, requestId, mode, contextSnapshotId, studioId, referenceImages });
export const cancelChatStream = (threadId: string) =>
  call<void>('cancel_chat_stream', { threadId });

export const listMcpConnectors = () => call<McpConnectorConfig[]>('list_mcp_connectors', {});
export const saveMcpConnector = (config: McpConnectorConfig) =>
  call<void>('save_mcp_connector', { config });
export const toggleMcpConnector = (id: string, enabled: boolean) =>
  call<void>('toggle_mcp_connector', { id, enabled });
export const deleteMcpConnector = (id: string) => call<void>('delete_mcp_connector', { id });
/** Starts the connector (or every enabled one) and returns the tools it really exposes. */
export const listAvailableMcpTools = (config?: McpConnectorConfig) =>
  call<McpToolInfo[]>('list_available_mcp_tools', { config: config ?? null });

export const probeRouterModels = () => call<RouterProbe>('probe_router_models', {});
export const listProviderModels = (profileId: string) => call<string[]>('list_provider_models', { profileId });
export type AttemptSummary = { id: string; profileId: string; providerId: string; modelId: string; status: string; startedAt: string; completedAt?: string; error?: string };
export const listTaskAttempts = (taskId: string) => call<AttemptSummary[]>('list_task_attempts', { taskId });
