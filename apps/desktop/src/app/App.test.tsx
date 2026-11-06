import { setStudioSnapshot } from '../services/studioState';
import { selectChoice } from '../tests/selectChoice';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { creativeFeatures, featureRegistry, isEditorRoute, resolveRoute, routeForVersion } from './featureRegistry';

it('matches editor shortcuts through canonical and legacy routes without leaking into other modes', () => {
  expect(isEditorRoute('#create/audio', 'audio', 'sfx')).toBe(true);
  expect(isEditorRoute('#sfx', 'audio', 'sfx')).toBe(true);
  expect(isEditorRoute('#create/audio?mode=music', 'audio', 'sfx')).toBe(false);
  expect(isEditorRoute('#create/visual?mode=thumbnail', 'visual', 'gfx', 'thumbnail')).toBe(true);
  expect(isEditorRoute('#create/visual?mode=icon', 'visual', 'gfx', 'thumbnail')).toBe(false);
  expect(isEditorRoute('#create/material?mode=texture', 'material', 'texture')).toBe(false);
  expect(isEditorRoute('#create/sky', 'sky')).toBe(true);
  expect(isEditorRoute('#chat', 'sky')).toBe(false);
});

vi.mock('../services/tauri', () => ({
  loadGfxDraft: vi.fn().mockResolvedValue(null),
  saveGfxDraft: vi.fn().mockImplementation(async (spec, baselineVersionId, revision) => ({ spec, baselineVersionId, revision: revision + 1, updatedAt: '1793000000000' })),
  listWorkspaceBackups: vi.fn().mockResolvedValue([]),
  listGfxVersions: vi.fn().mockResolvedValue([]), listGfxTasks: vi.fn().mockResolvedValue([]),
  getWorkspaceInfo: vi.fn().mockResolvedValue({ rootPath: '/local/workspace', orphanArtifacts: [] }),
  call: vi.fn().mockImplementation(async (cmd) => {
    if (cmd === 'obsidian_status') return { connected: true, mode: 'adaptive', message: 'ready' };
    if (cmd === 'list_connection_profiles') return [];
    if (cmd === 'get_fallback_policy') return { enabled: false, orderedProfileIds: [], allowedProviderIds: [] };
    if (cmd === 'get_router_connection') return { enabled: false };
    return [];
  }),
}));
vi.mock('../services/creatorWorkspace', async (load) => ({ ...await load<typeof import('../services/creatorWorkspace')>(), listLibrary: vi.fn().mockResolvedValue([]), listWorkTasks: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/sfx', () => ({ listSfxVersions: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/images', async (load) => ({ ...await load<typeof import('../services/images')>(), listImageVersions: vi.fn().mockResolvedValue([]) }));

beforeEach(() => {
  window.history.replaceState(null, '', '/'); window.location.hash = ''; localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => vi.unstubAllGlobals());
const nav = () => screen.getByRole('navigation', { name: 'Navigasi utama' });
const creative = () => within(nav()).getByRole('button', { name: 'Studio Kreatif' });
async function home() { await screen.findByRole('heading', { name: 'AI Chat' }, { timeout: 20000 }); }

it('keeps one canonical registry, nine editors, safe fallbacks and validated legacy modes', () => {
  expect(creativeFeatures).toHaveLength(9);
  expect(new Set(featureRegistry.map((item) => item.route)).size).toBe(11);
  expect(resolveRoute('').hash).toBe('chat');
  expect(resolveRoute('#unknown').hash).toBe('chat');
  expect(resolveRoute('#/chat').hash).toBe('chat');
  expect(resolveRoute('#icons').hash).toBe('create/visual?mode=icon');
  expect(resolveRoute('#clothing').hash).toBe('create/visual?mode=clothing');
  for (const route of ['#textures', '#texture', '#texture3d', '#create/material', '#create/material?mode=material', '#create/material?mode=texture']) {
    expect(resolveRoute(route).hash).toBe('chat');
    expect(resolveRoute(route).mode).toBeUndefined();
    expect(isEditorRoute(route, 'material', 'texture')).toBe(false);
  }
  expect(resolveRoute('#music').hash).toBe('create/audio?mode=music');
  expect(resolveRoute('#bridge').hash).toBe('settings');
  for (const section of ['studio', 'quality', 'tools', 'storage']) expect(resolveRoute(`#settings?section=${section}`).hash).toBe('settings');
  expect(resolveRoute('#create/visual?mode=../../secret').hash).toBe('create/visual');
  for (const legacy of ['terrain', 'city', 'activity', 'community', 'datastores', 'analytics', 'experience', 'uploader', 'downloader']) expect(resolveRoute(`#${legacy}`).hash).toBe('chat');
  expect(routeForVersion('icon')).toBe('create/visual?mode=icon');
});

it('shows one live Studio status in the top bar immediately after the AI Chat breadcrumb', async () => {
  render(<App />); await home();
  const topbar = document.querySelector('.topbar') as HTMLElement;
  const offline = within(topbar).getByRole('status', { name: 'Status koneksi Roblox Studio' });
  expect(offline).toHaveTextContent('Studio belum terhubung');
  expect(offline.previousElementSibling).toHaveTextContent('AI Chat');
  expect(offline.querySelector('svg')).not.toBeNull();
  expect(document.querySelector('.chat-header [aria-label="Status koneksi Roblox Studio"]')).toBeNull();
  act(() => setStudioSnapshot({ studio: { studioId: 'map-one', name: 'Map Pengujian.rbxl', placeId: null }, checkedAt: '1' }));
  expect(offline).toHaveTextContent('Studio terhubung');
  expect(offline).toHaveAttribute('data-connected', 'true');
  expect(offline).toHaveAttribute('title', 'Map Pengujian.rbxl');
  expect(screen.getAllByRole('status', { name: 'Status koneksi Roblox Studio' })).toHaveLength(1);
  act(() => setStudioSnapshot(null));
  expect(offline).toHaveTextContent('Studio belum terhubung');
  await userEvent.click(within(nav()).getByRole('link', { name: 'Pengaturan' }));
  await screen.findByRole('heading', { name: 'Pengaturan' }, { timeout: 10000 });
  expect(screen.queryByRole('status', { name: 'Status koneksi Roblox Studio' })).toBeNull();
});

describe('Chat home and inline navigation', () => {
  it('cold launches Chat without mounting GFX; shows exactly three primary controls', async () => {
    render(<App />); await home();
    expect(location.hash).toBe('#chat');
    expect(within(nav()).getAllByRole('link')).toHaveLength(2);
    expect(within(nav()).getAllByRole('button')).toHaveLength(1);
    for (const name of ['AI Chat', 'Pengaturan']) expect(within(nav()).getByRole('link', { name }).querySelector('svg')).not.toBeNull();
    expect(screen.queryByLabelText('Judul')).toBeNull();
    expect(screen.queryByText('Studio siap')).toBeNull();
    expect(screen.getByRole('status', { name: 'Status koneksi Roblox Studio' })).toHaveTextContent('Studio belum terhubung');
    expect(screen.queryByRole('button', { name: 'Hubungkan Studio' })).toBeNull();
    expect(screen.getAllByRole('button').filter((button) => button.closest('.chat-starters'))).toHaveLength(4);
  });
  it('renders nine inline links directly under parent and closes only after click', async () => {
    const user = userEvent.setup(); render(<App />); await home();
    await user.click(creative());
    const children = screen.getByRole('group', { name: 'Studio Kreatif' });
    expect(children.parentElement).toBe(creative().parentElement);
    expect(within(children).getAllByRole('link')).toHaveLength(9);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(within(children).getByRole('link', { name: 'Model 3D' }));
    expect(await screen.findByRole('heading', { name: 'Model 3D' }, { timeout: 20000 })).toBeVisible();
    expect(location.hash).toBe('#create/model-3d');
    expect(screen.queryByRole('group', { name: 'Studio Kreatif' })).toBeNull();
    expect(creative()).toHaveAttribute('data-current', 'true');
  });
  it('opens every creative destination without planned-feature dialogs', async () => {
    const user = userEvent.setup(); render(<App />); await home();
    for (const feature of creativeFeatures) {
      await user.click(creative());
      await user.click(screen.getByRole('link', { name: feature.label }));
      await waitFor(() => expect(document.querySelector('.page-body')).toHaveAttribute('id', feature.id));
      await waitFor(() => expect(screen.queryByText(`Membuka ${feature.label}...`)).toBeNull(), { timeout: 20000 });
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  }, 60000);
  it('redirects the retired texture editor to Chat and removes it from navigation', async () => {
    location.hash = 'texture3d'; render(<App />); await home();
    expect(location.hash).toBe('#chat');
    expect(screen.queryByRole('heading', { name: 'Generator Tekstur' })).toBeNull();
    await userEvent.click(creative());
    const links = within(screen.getByRole('group', { name: 'Studio Kreatif' }));
    expect(links.queryByRole('link', { name: /Tekstur|Material/ })).toBeNull();
  });
  it('supports arrows, Home/End, Space, Escape and outside click', async () => {
    const user = userEvent.setup(); render(<App />); await home();
    creative().focus(); await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Model 3D' })).toHaveFocus());
    await user.keyboard('{End}'); expect(screen.getByRole('link', { name: 'Langit & Atmosfer' })).toHaveFocus();
    await user.keyboard('{Home}'); expect(screen.getByRole('link', { name: 'Model 3D' })).toHaveFocus();
    await user.keyboard('{Escape}'); expect(creative()).toHaveFocus();
    expect(creative()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' '); expect(creative()).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('heading', { name: 'AI Chat' })); expect(creative()).toHaveAttribute('aria-expanded', 'false');
    creative().focus(); await user.keyboard(' {Tab}');
    expect(creative()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{End}{Tab}{Tab}');
    expect(creative()).toHaveAttribute('aria-expanded', 'false');
  });
  it('redirects unknown routes and logo to Chat, no GFX flash', async () => {
    location.hash = 'unknown'; render(<App />); await home();
    expect(location.hash).toBe('#chat');
    await userEvent.click(within(nav()).getByRole('link', { name: 'Pengaturan' }));
    await screen.findByRole('heading', { name: 'Pengaturan' }, { timeout: 10000 });
    await userEvent.click(screen.getByRole('link', { name: 'ForgeKit Studio' }));
    await home(); expect(screen.queryByLabelText('Judul')).toBeNull();
  });
  it('preserves edited GFX draft through canonical navigation and mode changes', async () => {
    location.hash = 'gfx'; const user = userEvent.setup(); render(<App />);
    const input = await screen.findByLabelText('Judul'); await waitFor(() => expect(input).toBeEnabled());
    await user.clear(input); await user.type(input, 'Karya berikutnya');
    await selectChoice(screen.getByLabelText('Mode Desain Visual'), 'icon');
    await screen.findByRole('heading', { name: 'Generator Ikon' });
    await user.click(within(nav()).getByRole('link', { name: 'Pengaturan' }));
    await screen.findByRole('heading', { name: 'Pengaturan' }, { timeout: 10000 });
    await user.click(creative()); await user.click(screen.getByRole('link', { name: 'Desain Visual' }));
    expect(await screen.findByLabelText('Judul')).toHaveValue('Karya berikutnya');
  });
  it('keeps panel access contextual and examples populate composer without sending', async () => {
    const user = userEvent.setup(); render(<App />); await home();
    await user.click(screen.getByRole('button', { name: /Jelaskan struktur map/ }));
    expect(screen.getByLabelText('Input pesan chat')).toHaveValue('Jelaskan struktur map ini dan script yang mengatur gameplay.');
    await user.click(screen.getByRole('button', { name: 'Riwayat percakapan' }));
    expect(screen.getByRole('complementary', { name: 'Riwayat percakapan' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tutup panel konteks' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

it('command palette uses registry, filters retired tools and returns focus', async () => {
  const user = userEvent.setup(); render(<App />); await home();
  const origin = within(nav()).getByRole('link', { name: 'AI Chat' }); origin.focus();
  await user.keyboard('{Control>}k{/Control}');
  expect(within(screen.getByRole('dialog')).getAllByRole('option')).toHaveLength(12);
  expect(screen.queryByRole('option', { name: /Terrain|Data Store|Komunitas|Duplicate|Tekstur|Material/ })).toBeNull();
  await user.type(screen.getByRole('combobox', { name: 'Cari perintah' }), 'animasi'); await user.keyboard('{Enter}');
  expect(await screen.findByRole('heading', { name: 'Animasi' })).toBeVisible();
  await waitFor(() => expect(origin).toHaveFocus());
  expect(document.querySelector('.topbar-actions')).toBeNull();
  await user.keyboard('{Control>}k{/Control}'); await user.type(screen.getByRole('combobox', { name: 'Cari perintah' }), 'tidak-ada-perintah');
  await user.keyboard('{ArrowDown}{Enter}'); expect(screen.getByText('Tidak ada perintah yang cocok.')).toBeVisible();
  await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows account, providers and appearance together without retired settings tabs', async () => {
  location.hash = 'settings?section=studio'; render(<App />);
  await screen.findByRole('heading', { name: 'Pengaturan' }, { timeout: 10000 });
  expect(screen.getByRole('heading', { name: 'Provider AI' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Akun Discord' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Tampilan' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Bagian pengaturan' })).toBeNull();
  for (const name of ['Roblox Studio', 'Kualitas & Anggaran', 'Tools & Skills', 'Penyimpanan & Diagnostik']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
    if (name === 'Roblox Studio') expect(screen.getByRole('heading', { name })).not.toBeVisible();
    else expect(screen.queryByRole('heading', { name })).toBeNull();
  }
  await waitFor(() => expect(location.hash).toBe('#settings'));
});

it('persists appearance, follows system changes and retains density/motion preferences', async () => {
  let dark = false; const media = new EventTarget(); Object.defineProperty(media, 'matches', { get: () => dark });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  location.hash = 'settings?section=appearance'; const user = userEvent.setup(); const view = render(<App />);
  await screen.findByRole('heading', { name: 'Tampilan' });
  expect(document.documentElement.dataset.theme).toBe('dark');
  await user.click(screen.getByRole('button', { name: 'Sistem' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => { dark = true; media.dispatchEvent(new Event('change')); }); expect(document.documentElement.dataset.theme).toBe('dark');
  await user.click(screen.getByRole('button', { name: 'Terang' }));
  await user.click(screen.getByRole('button', { name: 'Ringkas' }));
  await user.click(screen.getByRole('checkbox', { name: /Kurangi animasi tambahan/ }));
  expect(localStorage.getItem('forgekit-theme')).toBe('light');
  expect(document.documentElement.dataset.density).toBe('compact');
  expect(document.documentElement.dataset.motion).toBe('reduce');
  view.unmount(); render(<App />); await screen.findByRole('heading', { name: 'Tampilan' });
  expect(screen.getByRole('button', { name: 'Terang' })).toHaveAttribute('aria-pressed', 'true');
});
