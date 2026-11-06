// Development-only stand-in for the Tauri backend, loaded with `?mock` on the Vite dev server so
// every page can be laid out and reviewed with realistic data in an ordinary browser. It is never
// part of a release build (see main.tsx).
type Args = Record<string, unknown> | undefined;

const now = Math.floor(Date.now() / 1000);
const account = {
  id: 'mock-claude', providerId: 'claude', connectionMode: 'direct', credentialOwner: 'forgekit', authMethod: 'claude_code',
  label: 'kreator@example.com · Claude Code', identity: { issuer: 'https://claude.ai', subject: 'org', email: 'kreator@example.com' },
  registrationRef: 'claude_code_managed', credentialRef: 'claude-mock-claude', accessState: 'ready', enabled: true,
  fallbackEligible: 'unknown', priority: 0, quotaBucketRefs: ['claude:org'], baseUrl: 'https://claude.ai/claude-code',
  model: 'opus', isDefault: true, createdAt: '1', updatedAt: '1',
};
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const models = [
  ['opus', 'Claude Opus 5.5'], ['sonnet', 'Claude Sonnet 5.5'], ['haiku', 'Claude Haiku 5.5'], ['fable', 'Claude Fable 5.1'],
  ['opus[1m]', 'Claude Opus 5.5 · konteks 1M'], ['claude-opus-4-8', 'Claude Opus 4.8'], ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
].map(([id, displayName]) => ({ id, displayName, reasoningEfforts: efforts, defaultReasoningEffort: null, toolCalling: 'supported' }));
const thread = { id: 'mock-thread', title: 'Sistem checkpoint obby', providerId: 'mock-claude', model: 'opus', createdAt: '1', updatedAt: '1' };
const messages = [
  { id: 'm1', threadId: thread.id, sequence: 1, role: 'user', content: 'Buat sistem checkpoint untuk obby di area yang saya pilih.', createdAt: '1' },
  { id: 'm2', threadId: thread.id, sequence: 2, role: 'assistant', createdAt: '2', content: '## Rencana checkpoint\n\nSaya akan membuat **5 checkpoint** di jalur obby:\n\n- Part `Checkpoint` transparan dengan atribut `Stage`.\n- Script server yang menyimpan stage terakhir per pemain.\n- Respawn otomatis ke checkpoint terakhir.\n\n```lua\nlocal Players = game:GetService("Players")\n```\n\nSetiap perubahan tercatat sebagai satu langkah Undo di Studio.' },
];
const usage = {
  profileId: 'mock-claude', status: 'available', source: 'claude_code', observedAt: now, checkedAt: now, planType: 'max', message: null,
  windows: [
    { id: 'claude:session', label: '5 jam', scope: 'claude', usedPercent: 14, windowDurationMins: 300, resetsAt: now + 5400, remaining: null, limit: null, unit: null },
    { id: 'claude:week', label: 'Mingguan', scope: 'claude', usedPercent: 9, windowDurationMins: 10080, resetsAt: now + 400000, remaining: null, limit: null, unit: null },
  ],
};
const fixtures: Record<string, (args: Args) => unknown> = {
  list_connection_profiles: () => [account],
  get_router_connection: () => ({ id: 'default-9router', baseUrl: 'http://127.0.0.1:20128/v1', routingOwner: 'router', managementAccess: 'unknown', detectedVersion: null, inferenceCredentialRef: null, dashboardUrl: null, createdAt: '1', updatedAt: '1' }),
  get_fallback_policy: () => ({ id: 'default-fallback-policy', enabled: false, orderedProfileIds: [], allowedProviderIds: ['claude'], allowCrossProvider: false, allowModelChange: false, routingOwner: 'forgekit', maxAttempts: 2, maxElapsedMs: 60000 }),
  list_ai_providers: () => [],
  get_provider_model_catalog: () => models,
  list_provider_models: () => models.map((m) => m.id),
  get_provider_usage: () => usage,
  list_chat_threads: () => [thread],
  load_chat_thread: () => messages,
  latest_chat_turn: () => null,
  list_task_attempts: () => [],
  list_tool_approvals: () => [],
  obsidian_status: () => ({ connected: true, message: '', skillCount: 25, learnedSkillCount: 7, learningEnabled: true }),
  get_discord_account: () => ({ clientId: null, redirectUri: 'http://127.0.0.1:38473/auth/callback', profile: null }),
  get_workspace_info: () => ({ rootPath: '/Users/kreator/Library/Application Support/dev.forgekit.studio', orphanArtifacts: [] }),
  blender_status: () => ({ available: true }),
  probe_studio: () => ({ executable: 'StudioMCP', protocolVersion: '2025-06-18', serverName: 'Studio', checkedAt: String(Date.now()), availability: 'mcp_ready', readTools: [], studios: [{ studioId: 'studio-1', name: 'Obby Hutan', placeId: 7, target: { studioId: 'studio-1', placeId: '7', mode: 'edit' } }] }),
  get_google_oauth_config: () => ({ clientId: null, configured: false }),
  hunyuan_load_config: () => ({ endpoint: '', hasToken: false, configured: false }),
  hunyuan_health: () => ({ ok: false }),
  hunyuan_list_models: () => [],
};
const listeners = new Map<number, (event: unknown) => void>();
let nextId = 1;
const internals = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  transformCallback(callback: (event: unknown) => void) { const id = nextId++; listeners.set(id, callback); return id; },
  unregisterCallback(id: number) { listeners.delete(id); },
  async invoke(command: string, args: Args) {
    if (command.startsWith('plugin:')) return command.endsWith('|listen') ? nextId++ : null;
    const fixture = fixtures[command];
    if (fixture) return structuredClone(fixture(args));
    if (command.startsWith('list_')) return [];
    console.info(`[mock] ${command} has no fixture`);
    throw { code: 'IPC_ERROR', message: `Mock: ${command} tidak tersedia di pratinjau.` };
  },
  convertFileSrc: (path: string) => path,
};
Object.assign(window as unknown as Record<string, unknown>, { isTauri: true, __TAURI_INTERNALS__: internals, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} } });
export {};
