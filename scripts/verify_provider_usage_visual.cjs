// Deterministic UI/IPC fixtures; never signs in, sends inference, or changes Studio.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.FORGEKIT_PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../docs/screenshots/provider-usage');
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.clock.install();
    await page.addInitScript(() => {
      let saved = [], request, done = false;
      const profiles = [
        ['primary', 'Akun desain', 'openai'], ['personal', 'Akun pribadi', 'openai'],
        ['claude', 'Tim Claude', 'anthropic'], ['gemini', 'Tim Gemini', 'gemini'],
      ].map(([id, label, providerId], i) => ({ id, label, providerId, isDefault: i === 0, connectionMode: 'direct', credentialOwner: 'forgekit', authMethod: i < 2 ? 'browser_oauth' : 'api_key', accessState: 'ready', enabled: true, fallbackEligible: 'supported', priority: i, quotaBucketRefs: [id], baseUrl: 'https://api.openai.com/v1', model: 'fixture-model', identity: { email: `${id}@example.test` }, createdAt: '1', updatedAt: '1' }));
      window.usageCalls = [];
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'list_connection_profiles') return profiles;
        if (command === 'get_fallback_policy' || command === 'get_router_connection') return null;
        if (command === 'get_provider_model_catalog') return [{ id: 'fixture-model', displayName: 'Model fixture', reasoningEfforts: ['low', 'medium', 'high'] }];
        if (command === 'get_provider_usage') {
          window.usageCalls.push(args.profileId);
          const available = args.profileId === 'primary';
          return { profileId: args.profileId, status: available ? 'available' : 'unavailable', source: available ? 'codex' : 'none', checkedAt: Math.floor(Date.now() / 1000), observedAt: available ? Math.floor(Date.now() / 1000) : null, planType: available ? 'plus' : null,
            message: args.profileId === 'personal' ? 'Koneksi Sign in with ChatGPT ini belum menyediakan pembacaan limit 5 jam/mingguan. Periksa ChatGPT → Pengaturan → Usage.' : available ? null : 'Provider ini belum menyediakan pembacaan kuota akun melalui koneksi yang digunakan.',
            windows: available ? [{ id: '5h', label: '5 jam', scope: 'codex', usedPercent: done ? 40 : 32, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200, remaining: null, limit: null, unit: null }, { id: 'week', label: 'Mingguan', scope: 'codex', usedPercent: 20, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 172800, remaining: null, limit: null, unit: null }] : [] };
        }
        if (command === 'get_discord_account') return null;
        if (command === 'probe_studio') return { studios: [], checkedAt: String(Date.now()), readTools: [], executable: '', serverName: 'Fixture', protocolVersion: '' };
        if (command === 'list_chat_threads') return [];
        if (command === 'create_chat_thread') return { id: 'fixture-thread', title: args.title, model: args.model, createdAt: '1', updatedAt: '1' };
        if (command === 'load_chat_thread') return saved;
        if (command === 'latest_chat_turn') return done ? { id: request.requestId, status: 'completed', mode: 'auto', toolResults: [] } : null;
        if (command === 'send_chat_message') {
          request = args;
          saved = [{ id: 'user', threadId: args.threadId, role: 'user', content: args.userContent, createdAt: '1' }];
          return new Promise(resolve => { window.finishFixture = () => { done = true; const answer = { id: 'answer', threadId: args.threadId, role: 'assistant', content: 'Tugas fixture selesai.', createdAt: '2' }; saved.push(answer); resolve(answer); }; });
        }
        if (command === 'get_creative_task') return { id: args.id, status: done ? 'completed' : 'streaming', events: [], toolResults: [] };
        if (command === 'list_task_attempts') return done ? ['primary', 'personal'].map(profileId => ({ id: profileId, profileId, providerId: 'openai', modelId: 'fixture-model', status: 'succeeded', startedAt: '1' })) : [];
        if (command.startsWith('list_')) return [];
        if (['load_creator_draft', 'load_gfx_draft'].includes(command)) return null;
        throw new Error(`Fixture command unavailable: ${command}`);
      } };
    });
    await page.goto(process.env.FORGEKIT_PREVIEW_URL || 'http://127.0.0.1:1423');
    await page.getByRole('combobox', { name: 'Model AI', exact: true }).filter({ hasText: 'Model fixture' }).waitFor();
    const picker = page.locator('.chat-composer-options .provider-picker [role="combobox"]');
    assert.equal(await picker.textContent(), '');
    assert.equal(await picker.locator('img').getAttribute('src'), '/branding/providers/openai.svg');
    assert.equal(await page.evaluate(() => window.usageCalls.length), 0);
    await picker.click();
    await page.getByText('68% tersisa', { exact: true }).waitFor();
    const menu = page.locator('.provider-picker-menu');
    assert.equal(await menu.getByRole('option').count(), 4);
    assert.equal(await menu.getByText('Akun desain', { exact: true }).count(), 1);
    assert.equal(await menu.getByText('Utama', { exact: true }).count(), 1);
    assert.equal(await menu.getByText(/Default/).count(), 0);
    assert.deepEqual(await menu.locator('.dropdown-group-heading').allTextContents(), ['OpenAI', 'Claude', 'Gemini']);
    assert.equal(await menu.locator('time').count(), 2);
    checks.push('Logo-only trigger; provider groups, account identity, primary once, 5h/weekly remaining and reset');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [1440, 1024, 900]) {
        await picker.press('Escape');
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 700 });
        await picker.click();
        const box = await menu.boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= (width === 1440 ? 900 : 700));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: path.join(output, `chat-${theme}-${width}.png`), animations: 'disabled' });
      }
    }
    checks.push('Dropdown fits 1440/1024/900 viewports in light/dark without horizontal overflow');
    await picker.press('Escape');
    await page.setViewportSize({ width: 900, height: 620 });
    await picker.click();
    const minimum = await menu.boundingBox();
    assert(minimum && minimum.y >= 0 && minimum.y + minimum.height <= 620);
    await page.screenshot({ path: path.join(output, 'minimum-window-900-620.png'), animations: 'disabled' });
    checks.push('Dropdown remains inside the configured minimum 900×620 window');
    await menu.getByRole('option').filter({ hasText: 'Tim Claude' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'provider-groups-unavailable.png'), animations: 'disabled' });
    await picker.press('Home');
    await picker.press('ArrowDown');
    await picker.press('ArrowDown');
    await picker.press('Enter');
    assert.equal(await picker.getAttribute('value'), 'claude');
    assert.equal(await picker.locator('img').getAttribute('src'), '/branding/providers/claude.svg');
    await picker.click();
    await menu.getByRole('option').filter({ hasText: 'Akun desain' }).click();
    checks.push('Pointer and keyboard selection preserve account and matching provider logo');
    const before = await page.evaluate(() => window.usageCalls.length);
    await picker.click();
    await page.clock.runFor(30_100);
    await page.waitForFunction(count => window.usageCalls.length > count, before);
    await picker.press('Escape');
    const closed = await page.evaluate(() => window.usageCalls.length);
    await page.clock.runFor(31_000);
    assert.equal(await page.evaluate(() => window.usageCalls.length), closed);
    checks.push('Usage refreshes every 30 seconds while visible and stops with the dropdown closed');
    await page.getByRole('textbox', { name: 'Input pesan chat' }).fill('Jalankan tugas fixture.');
    await page.getByRole('button', { name: 'Kirim', exact: true }).click();
    await page.waitForFunction(() => !!window.finishFixture);
    const afterStart = await page.evaluate(() => window.usageCalls.length);
    await page.evaluate(() => window.finishFixture());
    await page.waitForFunction(count => window.usageCalls.length >= count + 2, afterStart);
    assert.deepEqual((await page.evaluate(() => window.usageCalls)).slice(-2).sort(), ['personal', 'primary']);
    await picker.click();
    await page.getByText('60% tersisa', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'after-task-refresh.png'), animations: 'disabled' });
    checks.push('Settled task refreshes selected and actual fallback accounts; updated remaining shown');
    await picker.press('Escape');
    await page.evaluate(() => { location.hash = 'create/model-3d'; });
    const activePicker = page.locator('.provider-picker [role="combobox"]:visible');
    await activePicker.waitFor();
    await activePicker.click();
    await page.getByRole('option').filter({ hasText: 'Perencana lokal (aturan)' }).waitFor();
    assert.equal(await page.getByText('Aturan lokal · tanpa kuota provider', { exact: true }).count(), 1);
    await page.screenshot({ path: path.join(output, 'generator-provider-picker.png'), animations: 'disabled' });
    checks.push('Shared generator selector provides the same groups and an explicit local option');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ok: true, evidence: 'Browser IPC fixtures only; official quotas here are fixtures, not live-account proof', checks, errors }, null, 2) + '\n');
    console.log(`PASS ${checks.length} provider usage visual checks; 10 screenshots`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
