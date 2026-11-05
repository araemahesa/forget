// Real WKWebView/IPC and native resolver, with a local HTTP fixture provider.
window.addEventListener('DOMContentLoaded', async () => {
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  try {
    const settings = await invoke('get_fallback_policy');
    const suffix = crypto.randomUUID();
    const profiles = [];
    for (const name of ['a', 'b']) {
      const profile = {
        id: `fixture-${name}-${suffix}`, providerId: 'openai-compatible', connectionMode: 'direct',
        credentialOwner: 'forgekit', authMethod: 'api_key', label: `Native fixture ${name}`,
        accessState: 'ready', enabled: true, fallbackEligible: 'supported', priority: 0,
        quotaBucketRefs: [`fixture-${name}-${suffix}`],
        baseUrl: `http://127.0.0.1:21473/${name}/v1`, model: 'fixture-model',
        isDefault: name === 'a', createdAt: '1', updatedAt: '1',
      };
      await invoke('save_connection_profile', { profile });
      const saved = (await invoke('list_connection_profiles')).find((p) => p.id === profile.id);
      assert(saved.accessState === 'pending', 'Renderer cannot claim ready before inference');
      assert(saved.credentialRef === `provider-${profile.id}`, 'Credential references must be unique');
      assert((await invoke('test_connection_profile', { profile })).ok, 'Text probe failed');
      profiles.push(saved);
    }
    let policyRejected = false;
    try { await invoke('save_fallback_policy', { policy: { ...settings, enabled: true, orderedProfileIds: [profiles[1].id], allowedProviderIds: ['openai-compatible'], maxAttempts: 2, maxElapsedMs: 30000 } }); } catch { policyRejected = true; }
    assert(policyRejected, 'Cross-account fallback policy must be rejected');
    const allProviders = await invoke('list_ai_providers');
    const provider = allProviders.find(p => p.id === profiles[0].id);
    const thread = await invoke('create_chat_thread', { title: 'Native strict routing fixture', model: provider.model, providerId: provider.id });
    const requestId = crypto.randomUUID();
    let failed = false;
    try { await invoke('send_chat_message', { threadId: thread.id, userContent: 'FORGEKIT_STRICT_CHECK', provider, requestId, mode: 'ask' }); } catch { failed = true; }
    assert(failed, 'A429 must fail without silently using B');
    const attempts = await invoke('list_task_attempts', { taskId: requestId });
    assert(attempts.length === 1 && attempts[0].profileId === provider.id && attempts[0].status === 'rate_limited', 'Unexpected cross-account attempt');
    const messages = await invoke('load_chat_thread', { threadId: thread.id });
    assert(messages.length === 1 && messages[0].role === 'user', 'Failure created a synthetic assistant response');
    const selectedB = allProviders.find(p => p.id === profiles[1].id);
    const bThread = await invoke('create_chat_thread', { title: 'Explicit B selection', model: selectedB.model, providerId: selectedB.id });
    const bResult = await invoke('send_chat_message', { threadId: bThread.id, userContent: 'FORGEKIT_STRICT_CHECK', provider: selectedB, requestId: crypto.randomUUID(), mode: 'ask' });
    assert(bResult.content === 'SELECTED_B_OK', 'Explicit account B request failed');
    await invoke('delete_connection_profile', { id: profiles[0].id });
    assert((await invoke('load_chat_thread', { threadId: thread.id })).length === 1, 'Disconnect removed chat history');
    assert((await invoke('list_connection_profiles')).some((p) => p.id === profiles[1].id), 'Disconnect removed another account');
    await invoke('save_fallback_policy', { policy: settings });
    await invoke('record_runtime_acceptance', { result: {
      ok: true, phase: 'connections', realNativePersistence: true, providerLive: false, studioLive: false,
      evidence: 'Native IPC, SQLite and curl transport with strict account routing against local HTTP fixture; no upstream login',
      policyRejected, attempts, messageCount: messages.length, disconnectedHistoryPreserved: true,
    } });
  } catch (error) {
    await invoke('record_runtime_acceptance', { result: { ok: false, phase: 'connections', error: String(error), message: error?.message } });
  }
});
