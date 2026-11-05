// Deterministic UI/IPC fixtures; never signs in, sends inference, or changes Studio.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('/Users/ariardianto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const output = path.resolve(__dirname, '../docs/test-evidence/2026-10-31/account-explorer-layout');
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

    await page.goto('http://127.0.0.1:1432');
    await page.getByRole('combobox', { name: 'Model AI', exact: true }).filter({ hasText: 'Model fixture' }).waitFor();
    assert.equal(await page.locator('.topbar-actions').count(), 0);
    assert.equal(await page.getByRole('button', { name:'Karya tersimpan',exact:true }).count(),0);
    const picker=page.getByRole('combobox',{name:'Provider percakapan',exact:true});
    const menu=page.locator('.provider-picker-menu');
    const assertInside=async(locator,width,height)=>{const box=await locator.boundingBox(); assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify({width,height,box}));};
    for(const theme of ['dark','light']) for(const [width,height] of [[1440,900],[1024,700],[720,450]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await picker.click();
      assert.equal(await menu.getByRole('option').count(),3);
      assert.equal(await menu.getByText('Akun desain',{exact:true}).count(),0);
      await assertInside(menu,width,height);
      await page.screenshot({path:path.join(output,`providers-${theme}-${width}.png`)});
      await menu.getByRole('option',{name:'OpenAI',exact:true}).click();
      assert.equal(await menu.getByRole('option').count(),2);
      assert.equal(await menu.locator('.provider-usage').count(),0);
      await assertInside(menu,width,height);
      await page.screenshot({path:path.join(output,`accounts-${theme}-${width}.png`)});
      await picker.press('Escape');
      await page.getByRole('button',{name:'Buka panel rincian penggunaan kuota provider'}).click();
      const panel=page.locator('.orca-usage-panel');
      await page.getByText('32% terpakai',{exact:true}).waitFor();
      await assertInside(panel,width,height);
      assert.equal(await panel.getByRole('option').count(),4);
      const overflow=await panel.evaluate(el=>[...el.querySelectorAll('section')].some(x=>x.scrollWidth>x.clientWidth+1));
      assert(!overflow,'Usage section horizontally overflows');
      await page.screenshot({path:path.join(output,`usage-${theme}-${width}.png`)});
      await panel.getByRole('option').nth(1).click();
      await page.getByText('Akses Pembacaan Kuota Belum Tersedia').waitFor();
      await page.getByRole('button',{name:'Tutup panel usage'}).click();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      checks.push({theme,width,height,providerFirst:true,accountWithoutUsage:true,usagePanelFits:true});
    }
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole('button',{name:'Explorer map',exact:true}).click();
    await page.getByRole('complementary',{name:'Explorer map',exact:true}).waitFor();
    assert.equal(await page.getByRole('tree').count(),0);
    await page.screenshot({path:path.join(output,'explorer-disconnected.png')});
    assert.equal(errors.length,0,JSON.stringify(errors));
    await fs.writeFile(path.join(output,'browser-checks.json'),JSON.stringify({fixtureOnly:true,checks,errors},null,2));
    console.log(JSON.stringify({cases:checks.length,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
