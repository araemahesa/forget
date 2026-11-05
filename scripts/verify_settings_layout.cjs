// Layout-only IPC fixtures; no credentials, inference, or production data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('/Users/ariardianto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const output = path.resolve(__dirname, '../docs/test-evidence/2026-10-31/settings-layout/visual');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  const errors = [], captures = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const accounts = ['Akun pribadi · fixture', 'Akun desain dengan nama panjang · fixture'].map((label, index) => ({
        id: `fixture-${index}`, label, providerId: 'openai', connectionMode: 'direct', credentialOwner: 'forgekit',
        authMethod: 'codex_oauth', accessState: 'ready', enabled: true, isDefault: index === 0,
        fallbackEligible: 'unknown', priority: index, quotaBucketRefs: [`fixture-${index}`],
        baseUrl: 'https://chatgpt.com/backend-api/codex', model: 'fixture-model', createdAt: '1', updatedAt: '1',
      }));
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args = {}) => {
          if (command.startsWith('plugin:event|')) return 1;
          if (command === 'list_connection_profiles') return accounts;
          if (command === 'get_fallback_policy' || command === 'get_router_connection') return null;
          if (command === 'get_discord_account') return { clientId: null, redirectUri: 'http://127.0.0.1:38473/auth/callback', profile: null };
          if (command === 'get_google_oauth_config') return { configured: false, clientId: null, projectId: null };
          if (command === 'get_provider_model_catalog') return [{ id: 'fixture-model', displayName: 'Model fixture', reasoningEfforts: ['low', 'high'] }];
          if (command === 'get_provider_usage') {
            const now = Math.floor(Date.now() / 1000);
            return { profileId: args.profileId, status: 'available', source: 'codex', checkedAt: now, observedAt: now, planType: 'plus', message: null,
              windows: [{ id: '5h', label: '5h', scope: 'ChatGPT', usedPercent: 20, windowDurationMins: 300, resetsAt: now + 7200 },
                { id: 'week', label: 'Mingguan', scope: 'ChatGPT', usedPercent: 40, windowDurationMins: 10080, resetsAt: now + 432000 }] };
          }
          if (command === 'probe_studio') return { studios: [], checkedAt: String(Date.now()), readTools: [] };
          if (command.startsWith('list_')) return [];
          throw new Error(`Unsupported visual fixture command: ${command}`);
        },
      };
    });
    await page.goto(`${process.env.FORGEKIT_PREVIEW_URL || 'http://127.0.0.1:1421'}/#settings`);
    await page.getByText('Akun pribadi · fixture', { exact: true }).waitFor();
    assert.equal(await page.locator('.settings-tabs').count(), 0);
    for (const name of ['Provider AI', 'Akun Discord', 'Tampilan']) assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 1);
    for (const name of ['Roblox Studio', 'Kualitas & Anggaran', 'Tools & Skills', 'Penyimpanan & Diagnostik']) assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0);
    for (const theme of ['Gelap', 'Terang']) {
      await page.getByRole('button', { name: theme, exact: true }).click();
      for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 700], [720, 450]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}/${width}: page overflow`);
        const cards = await page.locator('.account-row').evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, scroll: node.scrollWidth })));
        assert(cards.every(card => card.scroll <= card.width), `${theme}/${width}: account overflow`);
        assert(await page.locator('.theme-mini').evaluateAll(nodes => nodes.every(node => {
          const outer = node.getBoundingClientRect();
          return [...node.querySelectorAll('i')].every(child => {
            const inner = child.getBoundingClientRect();
            return inner.bottom <= outer.bottom && inner.right <= outer.right;
          });
        })), `${theme}/${width}: theme preview overflow`);
        assert(await page.locator('.settings-preferences').evaluate(el => el.children.length === 2));
        assert(await page.locator('.provider-card-desc').evaluateAll(nodes => nodes.every(n => n.textContent.length < 40)));
        assert.equal(await page.locator('.account-row .provider-usage-note').count(),0);
        const name = `${theme === 'Gelap' ? 'dark' : 'light'}-${width}x${height}.png`;
        await page.screenshot({ path: path.join(output, name), fullPage: true, animations: 'disabled' });
        captures.push(name);
      }
    }
    await page.getByRole('button', { name: 'Koneksi API lanjutan untuk Claude' }).click();
    await page.getByLabel('Nama akun').waitFor();
    await page.keyboard.press('Escape');
    assert(await page.getByRole('button', { name: 'Koneksi API lanjutan untuk Claude' }).evaluate(node => document.activeElement === node));
    for (const section of ['studio', 'quality', 'tools', 'storage']) {
      await page.evaluate(section => { location.hash = `settings?section=${section}`; }, section);
      await page.waitForURL('**/#settings');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ok: true, context: 'Browser layout fixtures only; not live account evidence.', captures, errors }, null, 2));
    console.log(`Settings visual checks passed: ${captures.length} captures, both themes, account form and retired routes.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
