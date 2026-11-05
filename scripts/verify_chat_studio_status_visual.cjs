// Header layout fixtures only; no live Studio or provider claim.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.FORGEKIT_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const output = path.resolve(__dirname, '../docs/test-evidence/2026-10-30/studio-status-position/visual');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [], captures = [];
  try {
    for (const connected of [false, true]) for (const theme of ['dark', 'light']) {
      const page = await browser.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ connected, theme }) => {
        localStorage.setItem('forgekit-theme', theme);
        localStorage.setItem('forgekit:active-chat', 'fixture-thread');
        window.isTauri = true;
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback: () => 1, unregisterCallback: () => {},
          invoke: async command => {
            if (command.startsWith('plugin:event|')) return 1;
            if (command === 'probe_studio') return { studios: connected ? [{ studioId: 'fixture-map', name: 'Map fixture.rbxl', placeId: null }] : [], checkedAt: '1', readTools: [] };
            if (command === 'read_studio') return { content: [{ type: 'text', text: 'Current Studio Mode: Edit' }] };
            if (command === 'capture_studio_context') throw new Error('Bounded context unavailable in layout fixture.');
            if (command === 'get_discord_account') return { clientId: null, profile: null };
            if (command === 'list_chat_threads') return [{ id: 'fixture-thread', title: 'Judul percakapan yang sangat panjang untuk menguji kerapian header tanpa bertabrakan dengan status Studio dan tombol aksi. '.repeat(3), model: 'fixture', createdAt: '1', updatedAt: '1' }];
            if (command === 'load_chat_thread' || command.startsWith('list_')) return [];
            return null;
          },
        };
      }, { connected, theme });
      await page.goto(`${process.env.FORGEKIT_PREVIEW_URL || 'http://127.0.0.1:1422'}/#chat`);
      const badge = page.getByRole('status', { name: 'Status koneksi Roblox Studio' });
      await badge.getByText(connected ? 'Studio terhubung' : 'Studio belum terhubung', { exact: true }).waitFor();
      for (const width of [1440, 720, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page.locator('.topbar').evaluate(header => {
          const rect = node => node.getBoundingClientRect().toJSON();
          return { header: rect(header), title: rect(header.querySelector('.breadcrumb > strong')), badge: rect(header.querySelector('.topbar-studio-status')), brand: rect(header.querySelector('.topbar-brand')) };
        });
        for (const node of [geometry.brand, geometry.title, geometry.badge]) {
          assert(node.x >= geometry.header.x && node.right <= geometry.header.right + 1, 'Header child exceeds horizontal bounds.');
          assert(node.y >= geometry.header.y && node.bottom <= geometry.header.bottom + 1, 'Header child exceeds vertical bounds.');
        }
        assert(geometry.brand.right <= geometry.title.x && geometry.title.right <= geometry.badge.x, 'Brand, breadcrumb or status overlap.');
        assert(Math.abs((geometry.title.y + geometry.title.height / 2) - (geometry.badge.y + geometry.badge.height / 2)) < 2, 'Studio status is not aligned with AI Chat.');
        const name = `${theme}-${connected ? 'connected' : 'offline'}-${width}.png`;
        await page.screenshot({ path: path.join(output, name), clip: geometry.header, animations: 'disabled' });
        captures.push(name);
      }
      await page.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ok: true, context: 'Browser IPC fixtures; not live connection evidence.', captures, errors }, null, 2));
    console.log(`Passed ${captures.length} header layout checks.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
