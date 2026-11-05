// Opt-in native acceptance with ForgeKit's own selected account, isolated task/artifact DB.
// No Studio write, global login import, fallback or synthetic successful inference.
window.addEventListener('DOMContentLoaded', async () => {
  const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke(name, args);
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const visible = node => node && node.getBoundingClientRect().width > 0 && !node.closest('[hidden]');
  const wait = async (read, ms = 160000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = read(); if (value) return value; await new Promise(r => setTimeout(r, 80)); } throw Error(`Timeout ${read}`); };
  const button = text => [...document.querySelectorAll('button')].find(n => visible(n) && n.textContent.trim() === text);
  const fill = (node, value) => { Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
  const report = { phase: 'provider-only-live', native: true, providerLive: true, studioLive: false, isolatedData: true, checks: [] };
  try {
    await wait(() => document.querySelector('.chat-container'));
    const provider = (await invoke('list_ai_providers')).find(p => p.isDefault);
    assert(provider && provider.providerType !== 'local-llm', 'Ready selected provider missing');
    report.provider = { adapter: provider.providerType, model: provider.model, account: 'ForgeKit primary (redacted)' };
    const thread = await invoke('create_chat_thread', { title: 'Provider-only native live acceptance', providerId: provider.id, model: provider.model });
    const requestId = crypto.randomUUID();
    const message = await invoke('send_chat_message', { threadId: thread.id, userContent: 'Balas satu kalimat singkat dalam Bahasa Indonesia: sebutkan satu kegunaan editor game. Jangan memakai tools atau mengubah Studio.', provider, requestId, mode: 'ask' });
    assert(message.content.length > 10, 'No live Chat inference');
    const chat = await invoke('get_creative_task', { id: requestId });
    assert(chat.status === 'completed' && chat.provider.profileId === provider.id, 'Chat provenance mismatch');
    report.checks.push({ kind: 'chat', taskId: requestId, completed: true, responseLength: message.content.length, uiAction: false, nativeIpc: true });
    location.hash = 'create/model-3d';
    const prompt = await wait(() => document.querySelector('#model3d-prompt'));
    fill(prompt, 'Buat prop sederhana bernama ForgeKitLiveCheck: tepat dua bagian kubus dengan id stabil base dan top, warna merah #cc3344, tanpa perubahan Studio. Recipe saja.');
    await new Promise(r => setTimeout(r, 100));
    await wait(() => button('Generate') && !button('Generate').disabled);
    button('Generate').click();
    await wait(() => [...document.querySelectorAll('[role="status"]')].some(n => visible(n) && n.textContent.includes('Artefak prosedural tersimpan')));
    const parent = (await invoke('list_creative_versions', { kind: 'model3d' }))[0];
    assert(parent.document.recipe.parts.length === 2, 'Provider ignored measurable part count');
    assert(parent.document.recipe.parts.every(p => p.color.toLowerCase() === '#cc3344'), 'Provider ignored measurable color');
    assert(document.querySelector('.procedural-workspace canvas')?.width > 0, 'Native WebGL preview missing');
    report.checks.push({ kind: 'model3d', taskId: parent.taskId, id: parent.id, artifact: parent.artifact, uiAction: true, webgl: true });
    fill(document.querySelector('#model3d-refine'), 'Ubah hanya warna kedua bagian menjadi biru #3366cc. Pertahankan id, jumlah, bentuk, posisi, rotasi, ukuran, kategori dan seed.');
    await new Promise(r => setTimeout(r, 100)); button('Simpan revisi dari prompt').click();
    await wait(() => [...document.querySelectorAll('.generator-version')].filter(visible).length >= 2);
    const child = (await invoke('list_creative_versions', { kind: 'model3d' }))[0];
    assert(child.parentVersionId === parent.id, 'Refine parent lost');
    const expected = structuredClone(parent.document); expected.recipe.parts.forEach(p => p.color = '#3366cc');
    assert(JSON.stringify(child.document) === JSON.stringify(expected), 'Refine changed more than requested');
    report.checks.push({ kind: 'model3d-refine', taskId: child.taskId, id: child.id, parentId: parent.id, artifact: child.artifact, exactColorOnly: true, uiAction: true });
    location.hash = 'create/visual?mode=gfx';
    const input = await wait(() => [...document.querySelectorAll('[aria-label="Prompt instruksi AI"]')].find(visible));
    fill(input, 'Susun banner GFX berjudul ForgeKit LiveCheck, subtitle Provider asli, background #101216, accent #3366cc, layout centered, ukuran 640 x 360.');
    await new Promise(r => setTimeout(r, 100)); await wait(() => button('Susun AI') && !button('Susun AI').disabled); button('Susun AI').click();
    await wait(() => [...document.querySelectorAll('.editor-ai-feedback.success')].some(n => visible(n) && n.textContent.includes('Pratinjau diperbarui')));
    const editorTaskId = localStorage.getItem('forgekit:editor-task:gfx');
    const editor = await invoke('get_creative_task', { id: editorTaskId });
    assert(editor.status === 'completed' && editor.recovery.verification === 'passed', 'Editor native validation missing');
    const spec = JSON.parse(editor.candidate);
    assert(spec.title === 'ForgeKit LiveCheck' && spec.width === 640 && spec.height === 360, 'Editor ignored measurable constraints');
    assert([...document.querySelectorAll('svg, img, canvas')].some(visible), 'Native editor preview missing');
    report.checks.push({ kind: 'gfx', taskId: editorTaskId, validated: true, uiAction: true, preview: true });
    await invoke('record_runtime_acceptance', { result: { checkpoint: 'screenshots-ready', ...report } });
    // Leave the native result visible briefly for an independent window screenshot.
    await new Promise(r => setTimeout(r, 15000));
    await invoke('record_runtime_acceptance', { result: { ok: true, ...report } });
  } catch (error) { await invoke('record_runtime_acceptance', { result: { ok: false, ...report, error: String(error), message: error?.message } }); }
});
