// Opt-in real selected-provider + Blender integration; isolated database, no Studio calls.
window.addEventListener('DOMContentLoaded', async () => {
  const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke(name, args);
  const report = { phase: 'blender-reference-live', native: true, providerLive: true, blenderLive: true, studioLive: false, isolatedData: true, checks: [] };
  try {
    if (!(await invoke('blender_status')).available) throw Error('Installed Blender is required');
    const provider = (await invoke('list_ai_providers')).find(p => p.isDefault);
    if (!provider) throw Error('No selected ForgeKit-owned provider');
    const account = (await invoke('list_connection_profiles')).find(p => p.id === provider.id);
    const connection = await invoke('test_connection_profile', { profile: account });
    if (!connection.ok) throw Error('Selected connection test failed: ' + connection.message);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const c = canvas.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, 512, 512);
    c.fillStyle = '#15151c'; c.fillRect(340, 160, 16, 300);
    c.fillStyle = '#17c5ba'; c.beginPath(); c.moveTo(50, 210); c.bezierCurveTo(130, 20, 360, 20, 410, 180); c.lineTo(360, 160); c.bezierCurveTo(320, 70, 150, 90, 50, 210); c.fill();
    c.fillStyle = '#ecc75a'; c.fillRect(330, 250, 36, 24);
    const referenceImages = [{ name: 'blade-reference.png', dataUrl: canvas.toDataURL('image/png') }];
    const taskId = crypto.randomUUID();
    const version = await invoke('generate_creative', { request: { taskId, kind: 'model3d', prompt: 'Buat senjata 3D mengikuti gambar referensi. Bentuk melengkung harus memakai profile, gagang dan cincin terpisah. Ambil warna utama dari gambar. Maksimal 4 komponen, posisi dan proporsi mendekati gambar, ukuran total 8 studs. Geometri bervolume, bukan gambar datar. Jangan menambahkan efek atau gameplay.', quality: 'high', providerId: provider.id, modelId: provider.model, reasoningEffort: provider.reasoningEffort, parentVersionId: null, referenceImages, blender: false } });
    if (!version.document.recipe.parts.some(p => p.primitive === 'profile')) throw Error('Provider did not create custom contour');
    const bundle = await invoke('load_blender_bundle', { versionId: version.id });
    if (!bundle?.mesh?.meshes?.length || bundle.receipt.files.length !== 5) throw Error('Generator Blender output is missing');
    if (bundle.receipt.deliverable !== 'blend' || !bundle.receipt.referenceReview || bundle.views.length !== 3) throw Error('Reference comparison or .blend is missing');
    report.checks.push({ kind: 'generator', taskId, versionId: version.id, recipe: version.document.recipe, receipt: bundle.receipt, ok: true });
    await invoke('record_runtime_acceptance', { result: { ...report, checkpoint: 'generator' } });
    const thread = await invoke('create_chat_thread', { title: 'Blender reference acceptance', model: provider.model, providerId: provider.id, systemPrompt: null });
    const requestId = crypto.randomUUID();
    const answer = await invoke('send_chat_message', { threadId: thread.id, requestId, userContent: 'Buat satu model 3D senjata mengikuti gambar terlampir melalui Blender. Gunakan forgekit_blender_build untuk benar-benar menghasilkan file dan menyimpan model di ForgeKit. Maksimal tiga komponen: bilah profile bervolume, gagang, cincin. Warna mengikuti gambar. Tidak perlu Roblox atau gameplay. Selesaikan lalu beri tautan ke halaman Model 3D.', provider, mode: 'auto', referenceImages });
    const messages = await invoke('load_chat_thread', { threadId: thread.id });
    if (messages.find(m => m.role === 'user')?.toolResults?.[0]?.dataUrl !== referenceImages[0].dataUrl) throw Error('Reference missing from persisted chat');
    const versions = await invoke('list_creative_versions', { kind: 'model3d' });
    const chatModel = versions.find(v => v.id !== version.id);
    if (!chatModel) throw Error('AI Chat did not save its Blender model');
    const chatBundle = await invoke('load_blender_bundle', { versionId: chatModel.id });
    if (!chatBundle?.mesh?.meshes?.length) throw Error('AI Chat mesh is missing');
    report.checks.push({ kind: 'chat', requestId, threadId: thread.id, versionId: chatModel.id, referencePersisted: true, answer: answer.content, recipe: chatModel.document.recipe, receipt: chatBundle.receipt, ok: true });
    report.ok = true;
  } catch (error) { report.ok = false; report.error = String(error.message || error); }
  await invoke('record_runtime_acceptance', { result: report });
});
