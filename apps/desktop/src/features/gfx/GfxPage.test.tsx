import { selectChoice } from '../../tests/selectChoice';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GfxVersion } from '@forgekit/contracts';
import { GfxPage } from './GfxPage';
import { renderGfxSvg } from '../../engines/gfx/render';
import { createGfxTask, exportGfxArtifact, listGfxVersions, loadGfxDraft, loadGfxVersion, saveGfxVersion } from '../../services/tauri';

// Node's built-in crypto is available at runtime without adding Node types to the browser project.
const cryptoModule = 'node:crypto';
const { webcrypto } = await import(cryptoModule) as { webcrypto: Crypto };

// jsdom cannot rasterize Canvas or access native IPC. Hashing and rendering remain real.
vi.mock('../../engines/gfx/png', () => ({ svgToPng: vi.fn().mockResolvedValue(new Uint8Array([137, 80])) }));
vi.mock('../../services/tauri', () => ({
  loadGfxDraft: vi.fn().mockResolvedValue(null),
  saveGfxDraft: vi.fn().mockImplementation(async (spec, baselineVersionId, revision) => ({ spec, baselineVersionId, revision: revision + 1, updatedAt: '1793000000000' })),
  listWorkspaceBackups: vi.fn().mockResolvedValue([]),

  saveGfxVersion: vi.fn(), createGfxTask: vi.fn(), listGfxVersions: vi.fn(), loadGfxVersion: vi.fn(),
  cancelGfxTask: vi.fn(), getWorkspaceInfo: vi.fn().mockResolvedValue({ rootPath: '/local/workspace', orphanArtifacts: [] }),
  exportGfxArtifact: vi.fn(), NativeCommandError: class extends Error {},
}));

function savedVersion(): GfxVersion {
  const spec = { schemaVersion: 1 as const, title: 'Saved brief', subtitle: 'Subjudul', background: '#101216', accent: '#FF0033', layout: 'centered' as const, width: 1200, height: 800 };
  const svg = renderGfxSvg(spec).svg;
  return { id: 'gfx-2', itemId: 'item-1', sequence: 2, spec, checks: [], createdAt: '1792886400000', artifact: {
    svgRelativePath: 'gfx/gfx-2/graphic.svg', pngRelativePath: 'gfx/gfx-2/graphic.png',
    sha256: '', byteLength: new TextEncoder().encode(svg).length, pngSha256: 'test-png', pngByteLength: 42,
  } };
}

async function historyVersion(): Promise<GfxVersion> {
  const version = savedVersion();
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(renderGfxSvg(version.spec).svg));
  version.artifact!.sha256 = [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
  vi.mocked(listGfxVersions).mockResolvedValue([version]);
  vi.mocked(loadGfxVersion).mockResolvedValue(version);
  return version;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.mocked(listGfxVersions).mockResolvedValue([]);
  vi.mocked(createGfxTask).mockResolvedValue({ id: 'task-1', inputVersionId: 'input-1', outputVersionId: null, status: 'queued', error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GFX page', () => {
  it('restores unfinished fields without rendering or publishing a version', async () => {
    const spec = { ...savedVersion().spec, title: '', background: '#', width: -0.5 };
    vi.mocked(loadGfxDraft).mockResolvedValueOnce({ spec, baselineVersionId: null, revision: 6, updatedAt: 'now' });
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    expect(screen.getByLabelText('Judul')).toHaveValue('');
    expect(screen.getByLabelText('Latar')).toHaveValue('#');
    expect(screen.getByLabelText('Lebar')).toHaveValue(-0.5);
    expect(screen.getByText('Draf lokal dipulihkan.')).toBeVisible();
    expect(screen.queryByRole('img', { name: '' })).toBeNull();
    expect(createGfxTask).not.toHaveBeenCalled();
    expect(saveGfxVersion).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ekspor SVG' })).toBeDisabled();
  });

  it('verifies recovered baseline before restoring export identity', async () => {
    const version = await historyVersion();
    const reordered = Object.fromEntries(Object.entries(version.spec).reverse()) as typeof version.spec;
    vi.mocked(loadGfxDraft).mockResolvedValueOnce({ spec: reordered, baselineVersionId: version.id, revision: 7, updatedAt: 'now' });
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    expect(screen.getByText('Versi 2 tersimpan')).toBeVisible();
    expect(loadGfxVersion).toHaveBeenCalledWith(version.id);
    expect(screen.getByRole('button', { name: 'Ekspor SVG' })).toBeEnabled();
  });

  it.each([false, true])('retains saved versions when startup history arrives late (overlap: %s)', async (overlap) => {
    const version = await historyVersion();
    const previous = { ...version, id: 'gfx-1', sequence: 1 };
    let resolveHistory!: (history: GfxVersion[]) => void;
    const pendingHistory = new Promise<GfxVersion[]>((resolve) => { resolveHistory = resolve; });
    vi.mocked(listGfxVersions).mockReturnValueOnce(pendingHistory);
    vi.mocked(saveGfxVersion).mockResolvedValueOnce(version);
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.clear(screen.getByLabelText('Judul'));
    await user.type(screen.getByLabelText('Judul'), version.spec.title);
    await user.clear(screen.getByLabelText('Subjudul'));
    await user.type(screen.getByLabelText('Subjudul'), version.spec.subtitle);
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Buka versi 2' })).toBeVisible();

    await act(async () => { resolveHistory(overlap ? [version, previous] : [previous]); });

    const history = screen.getByRole('region', { name: 'Versi tersimpan' });
    expect(within(history).getAllByRole('button', { name: /^Buka versi/ }).map((button) => button.textContent)).toEqual(['Buka versi 2', 'Buka versi 1']);
    expect(screen.getByLabelText('2 versi tersimpan')).toBeVisible();
  });

  it('keeps one entry when startup history includes an in-flight save', async () => {
    const version = await historyVersion();
    const previous = { ...version, id: 'gfx-1', sequence: 1 };
    let resolveHistory!: (history: GfxVersion[]) => void;
    let resolveSave!: (saved: GfxVersion) => void;
    vi.mocked(listGfxVersions).mockReturnValueOnce(new Promise((resolve) => { resolveHistory = resolve; }));
    vi.mocked(saveGfxVersion).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.clear(screen.getByLabelText('Judul'));
    await user.type(screen.getByLabelText('Judul'), version.spec.title);
    await user.clear(screen.getByLabelText('Subjudul'));
    await user.type(screen.getByLabelText('Subjudul'), version.spec.subtitle);
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(saveGfxVersion).toHaveBeenCalled());
    await act(async () => { resolveHistory([version, previous]); });
    expect(screen.getByLabelText('2 versi tersimpan')).toBeVisible();

    await act(async () => { resolveSave(version); });
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();

    const history = screen.getByRole('region', { name: 'Versi tersimpan' });
    expect(within(history).getAllByRole('button', { name: /^Buka versi/ }).map((button) => button.textContent)).toEqual(['Buka versi 2', 'Buka versi 1']);
    expect(screen.getByLabelText('2 versi tersimpan')).toBeVisible();
  });

  it('reopens verified history into the real form and preview', async () => {
    await historyVersion();
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    expect(await screen.findByRole('img', { name: 'Saved brief' })).toBeVisible();
    expect(screen.getByLabelText('Judul')).toHaveValue('Saved brief');
    expect(screen.getByRole('button', { name: 'Ekspor SVG' })).toBeEnabled();
  });

  it('rejects renderer mismatch without replacing draft or enabling export', async () => {
    const version = await historyVersion();
    version.artifact!.sha256 = '0'.repeat(64);
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Render' }));
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    expect(await screen.findByText(/hash|integritas/i)).toBeVisible();
    expect(screen.getByLabelText('Judul')).toHaveValue('ForgeKit');
    expect(screen.getByRole('img', { name: 'ForgeKit' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ekspor SVG' })).toBeDisabled();
  });

  it('refuses metadata-only history without artifact evidence', async () => {
    const version = await historyVersion();
    version.artifact = null;
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    expect(await screen.findByText(/tidak memiliki artefak|artifact is missing/i)).toBeVisible();
    expect(screen.getByLabelText('Judul')).toHaveValue('ForgeKit');
    expect(screen.getByRole('button', { name: 'Ekspor SVG' })).toBeDisabled();
  });

  it('keeps all dirty fields and preview when replacement is declined', async () => {
    await historyVersion();
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.clear(screen.getByLabelText('Judul'));
    await user.type(screen.getByLabelText('Judul'), 'Unsaved work');
    await user.clear(screen.getByLabelText('Subjudul'));
    await user.type(screen.getByLabelText('Subjudul'), 'Keep subtitle');
    await user.click(screen.getByRole('button', { name: 'Render' }));
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    expect(screen.getByRole('dialog', { name: 'Ganti draf belum tersimpan?' })).toBeVisible();
    await user.keyboard('{Control>}s{/Control}');
    expect(saveGfxVersion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pertahankan draf' }));
    expect(screen.getByLabelText('Judul')).toHaveValue('Unsaved work');
    expect(screen.getByLabelText('Subjudul')).toHaveValue('Keep subtitle');
    expect(screen.getByRole('img', { name: 'Unsaved work' })).toBeVisible();
  });

  it('opens selected history after confirming dirty replacement', async () => {
    await historyVersion();
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.type(screen.getByLabelText('Judul'), ' changed');
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    await user.click(screen.getByRole('button', { name: 'Buang perubahan dan buka' }));
    expect(await screen.findByRole('img', { name: 'Saved brief' })).toBeVisible();
    expect(screen.getByLabelText('Judul')).toHaveValue('Saved brief');
  });

  it.each(['save', 'open'])('restores the saved identity after editing then reverting a %s baseline', async (entry) => {
    let version = await historyVersion();
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    expect(await screen.findByRole('img', { name: version.spec.title })).toBeVisible();
    if (entry === 'save') {
      version = { ...version, id: 'gfx-3', sequence: 3 };
      vi.mocked(saveGfxVersion).mockResolvedValueOnce(version);
      await user.keyboard('{Control>}s{/Control}');
      expect(await screen.findByText('Versi 3 disimpan.')).toBeVisible();
    }

    const title = screen.getByLabelText('Judul');
    await user.type(title, ' changed');
    expect(screen.getByText('Draf berubah')).toBeVisible();
    for (const kind of ['SVG', 'PNG']) expect(screen.getByRole('button', { name: `Ekspor ${kind}` })).toBeDisabled();
    await user.clear(title);
    await user.type(title, version.spec.title);

    expect(screen.getByText(`Versi ${version.sequence} tersimpan`)).toBeVisible();
    expect(screen.queryByText('Belum disimpan')).toBeNull();
    for (const kind of ['svg', 'png'] as const) {
      vi.mocked(exportGfxArtifact).mockResolvedValueOnce({ relativePath: `exports/reverted.${kind}`, sha256: 'test-export', byteLength: 42 });
      const action = screen.getByRole('button', { name: `Ekspor ${kind.toUpperCase()}` });
      expect(action).toBeEnabled();
      await user.click(action);
      expect(await screen.findByText(`Diekspor exports/reverted.${kind}`)).toBeVisible();
      expect(exportGfxArtifact).toHaveBeenLastCalledWith(version.id, kind);
    }
  });

  it('changes ratio to bounded integer dimensions and detects custom values', async () => {
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await selectChoice(screen.getByLabelText('Rasio aspek'), '16:9');
    expect(screen.getByLabelText('Lebar')).toHaveValue(1200);
    expect(screen.getByLabelText('Tinggi')).toHaveValue(675);
    await user.clear(screen.getByLabelText('Tinggi'));
    await user.type(screen.getByLabelText('Tinggi'), '777');
    expect(screen.getByLabelText('Rasio aspek')).toHaveValue('custom');
    await selectChoice(screen.getByLabelText('Rasio aspek'), '9:16');
    expect(screen.getByLabelText('Lebar')).toHaveValue(1197);
    expect(screen.getByLabelText('Tinggi')).toHaveValue(2128);
  });

  it('clamps preset ratio to valid minimum and maximum dimensions', async () => {
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.clear(screen.getByLabelText('Lebar'));
    await user.type(screen.getByLabelText('Lebar'), '128');
    await selectChoice(screen.getByLabelText('Rasio aspek'), '16:9');
    expect(screen.getByLabelText('Lebar')).toHaveValue(240);
    expect(screen.getByLabelText('Tinggi')).toHaveValue(135);
    await user.clear(screen.getByLabelText('Lebar'));
    await user.type(screen.getByLabelText('Lebar'), '4096');
    await selectChoice(screen.getByLabelText('Rasio aspek'), '9:16');
    expect(screen.getByLabelText('Lebar')).toHaveValue(2304);
    expect(screen.getByLabelText('Tinggi')).toHaveValue(4096);
  });

  it('provides keyboard-operable compact editor views without discarding draft', async () => {
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    const preview = screen.getByRole('button', { name: 'Pratinjau' });
    await user.click(preview);
    expect(preview).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Pengaturan' }));
    expect(screen.getByLabelText('Judul')).toHaveValue('ForgeKit');
  });

  it.each([
    ['Ctrl+Enter', '{Control>}{Enter}{/Control}'],
    ['Meta+Enter', '{Meta>}{Enter}{/Meta}'],
    ['Ctrl+S', '{Control>}s{/Control}'],
    ['Meta+S', '{Meta>}s{/Meta}'],
  ])('reveals compact controls before focusing invalid title after %s from preview', async (_, shortcut) => {
    const user = userEvent.setup();
    // jsdom has no media-query layout; apply the compact visibility rules directly.
    render(<><style>{'.gfx-workspace[data-view="preview"] .inspector, .gfx-workspace[data-view="controls"] .gfx-preview { display: none; }'}</style><GfxPage /></>);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    const title = screen.getByLabelText('Judul');
    const controls = screen.getByRole('button', { name: 'Pengaturan' });
    const preview = screen.getByRole('button', { name: 'Pratinjau' });
    await user.clear(title);
    await user.click(preview);
    expect(preview).toHaveAttribute('aria-pressed', 'true');
    expect(title).not.toBeVisible();

    await user.keyboard(shortcut);

    await waitFor(() => {
      expect(controls).toHaveAttribute('aria-pressed', 'true');
      expect(preview).toHaveAttribute('aria-pressed', 'false');
      expect(title).toBeVisible();
      expect(title).toHaveAttribute('aria-invalid', 'true');
      expect(title).toHaveFocus();
    });
    expect(createGfxTask).not.toHaveBeenCalled();
    expect(saveGfxVersion).not.toHaveBeenCalled();
  });

  it.each([
    ['long text', 'A'.repeat(120), 'B'.repeat(240), 'Teks diperkecil agar muat; gunakan teks lebih singkat.'],
    ['Unicode', 'Judul 世界', 'Subjudul café', 'Font Unicode dapat melampaui batas; periksa pratinjau.'],
  ])('keeps %s warnings accessible in compact preview without blocking render, save or export', async (_, title, subtitle, warning) => {
    const version = savedVersion();
    version.spec = { ...version.spec, title, subtitle };
    const svg = renderGfxSvg(version.spec).svg;
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(svg));
    version.artifact!.sha256 = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
    version.artifact!.byteLength = new TextEncoder().encode(svg).length;
    vi.mocked(saveGfxVersion).mockResolvedValueOnce(version);
    const user = userEvent.setup();
    render(<><style>{'.gfx-workspace[data-view="preview"] .inspector, .gfx-workspace[data-view="controls"] .gfx-preview { display: none; }'}</style><GfxPage /></>);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    const titleField = screen.getByLabelText('Judul');
    await user.clear(titleField);
    await user.click(titleField);
    await user.paste(title);
    await user.clear(screen.getByLabelText('Subjudul'));
    await user.click(screen.getByLabelText('Subjudul'));
    await user.paste(subtitle);
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }));

    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(screen.getByRole('img', { name: title })).toBeVisible();
    expect(titleField).toHaveAttribute('aria-invalid', 'false');
    const warnings = screen.getByRole('list', { name: 'Peringatan render' });
    expect(warnings).toBeVisible();
    expect(warnings.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(warnings.closest('.gfx-workspace')).toBeNull();
    const items = within(warnings).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const item of items) expect(item).toHaveTextContent(warning);
    expect(items[0]).toHaveTextContent('title');
    expect(items[1]).toHaveTextContent('subtitle');

    await user.keyboard('{Control>}s{/Control}');

    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pratinjau' })).toHaveAttribute('aria-pressed', 'true');
    expect(warnings).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Pengaturan' }));
    for (const kind of ['svg', 'png'] as const) {
      const relativePath = `exports/graphic.${kind}`;
      vi.mocked(exportGfxArtifact).mockResolvedValueOnce({ relativePath, sha256: 'test-export', byteLength: 42 });
      const exportButton = screen.getByRole('button', { name: `Ekspor ${kind.toUpperCase()}` });
      expect(exportButton).toBeEnabled();
      await user.click(exportButton);
      expect(await screen.findByText(`Diekspor ${relativePath}`)).toBeVisible();
      expect(exportGfxArtifact).toHaveBeenLastCalledWith(version.id, kind);
      expect(warnings).toBeVisible();
    }
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }));
    expect(warnings).toBeVisible();
  });

  it('reopens custom dimensions without changing ratio or rendered bytes', async () => {
    const version = await historyVersion();
    version.spec.width = 777;
    version.spec.height = 333;
    const svg = renderGfxSvg(version.spec).svg;
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(svg));
    version.artifact!.sha256 = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
    version.artifact!.byteLength = new TextEncoder().encode(svg).length;
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'Buka versi 2' }));
    expect(await screen.findByRole('img', { name: 'Saved brief' })).toBeVisible();
    expect(screen.getByLabelText('Rasio aspek')).toHaveValue('custom');
    expect(screen.getByLabelText('Lebar')).toHaveValue(777);
    expect(screen.getByLabelText('Tinggi')).toHaveValue(333);
  });

  it('renders editor controls and preview', async () => {
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'GFX Creator' })).toBeVisible();
    expect(screen.getByLabelText('Judul')).toBeVisible();
    expect(screen.getByLabelText('Subjudul')).toHaveValue('Berkreasi dengan jelas');
    expect(screen.getByRole('button', { name: 'Render' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Pratinjau GFX' })).toBeVisible();
  });

  it('keeps render, save and export reachable outside the compact inspector', async () => {
    const user = userEvent.setup();
    render(<><style>{'.gfx-workspace[data-view="preview"] .inspector { display: none; }'}</style><GfxPage /></>);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    const toolbar = screen.getByRole('group', { name: 'Aksi grafis' });
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }));
    expect(screen.getByLabelText('Judul')).not.toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Render' })).toHaveLength(1);
    await user.click(within(toolbar).getByRole('button', { name: 'Render' }));
    expect(screen.getByRole('img', { name: 'ForgeKit' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Simpan versi' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Simpan versi' })).toBeEnabled();
    for (const kind of ['SVG', 'PNG']) {
      expect(within(toolbar).getByRole('button', { name: `Ekspor ${kind}` })).toBeVisible();
      expect(within(toolbar).getByRole('button', { name: `Ekspor ${kind}` })).toBeDisabled();
    }
  });

  it('groups editable fields and keeps canvas dimensions in sync with the brief', async () => {
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    expect(within(screen.getByRole('group', { name: 'Teks' })).getByLabelText('Judul')).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Komposisi' })).getByLabelText('Tata letak')).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Ukuran' })).getByLabelText('Rasio aspek')).toBeVisible();
    const preview = screen.getByRole('region', { name: 'Pratinjau GFX' });
    expect(within(preview).getByRole('heading', { name: 'Pratinjau' })).toBeVisible();
    expect(preview.querySelector('.canvas-dimensions')).toHaveTextContent('1200 × 800 px');
    expect(screen.getByText('Belum disimpan')).toBeVisible();
    await selectChoice(screen.getByLabelText('Rasio aspek'), '16:9');
    expect(preview.querySelector('.canvas-dimensions')).toHaveTextContent('1200 × 675 px');
    expect(screen.getByText('Draf berubah')).toBeVisible();
    expect(preview.querySelector('.canvas-dimensions')).not.toHaveTextContent('1200 × 800 px');
  });

  it('shows validation errors without saving', async () => {
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.clear(screen.getByLabelText('Judul'));
    await user.click(screen.getByRole('button', { name: 'Render' }));
    expect(screen.getByRole('textbox', { name: /^Judul/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Simpan versi' })).toBeDisabled();
  });

  it('renders after Ctrl+Enter', async () => {
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByText('Pratinjau selesai.')).toBeVisible();
    expect(screen.getByRole('img', { name: 'ForgeKit' })).toBeVisible();
  });

  it('saves with Ctrl+S after rendering', async () => {
    const version = await historyVersion();
    vi.mocked(listGfxVersions).mockResolvedValue([]);
    vi.mocked(saveGfxVersion).mockResolvedValueOnce(version);
    const user = userEvent.setup();
    render(<GfxPage />);
    await waitFor(() => expect(screen.getByLabelText('Judul')).toBeEnabled());
    await user.clear(screen.getByLabelText('Judul'));
    await user.type(screen.getByLabelText('Judul'), version.spec.title);
    await user.clear(screen.getByLabelText('Subjudul'));
    await user.type(screen.getByLabelText('Subjudul'), version.spec.subtitle);
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();
  });
});
