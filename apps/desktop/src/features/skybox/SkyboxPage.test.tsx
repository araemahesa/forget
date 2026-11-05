import { selectChoice } from '../../tests/selectChoice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreativeVersion, SkyboxRecipe } from '@forgekit/contracts';
import { skyboxPresetsData } from '@forgekit/contracts';
import { call } from '../../services/tauri';
import { SkyboxPage } from './SkyboxPage';

vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
vi.mock('../../services/providerState', () => ({ useProviders: () => ({ profiles: [{ id: 'sky-account', providerType: 'openai-compatible', name: 'Fixture', model: 'fixture-model', isDefault: true }], defaultProvider: { id: 'sky-account', providerType: 'openai-compatible', name: 'Fixture', model: 'fixture-model', isDefault: true } }) }));

let versions: CreativeVersion[];
let failed: boolean;
const recipe: SkyboxRecipe = { ...skyboxPresetsData.sunset, name: 'Langit dari fixture', seed: 123 };

beforeEach(() => {
  versions = []; failed = false;
  vi.mocked(call).mockReset().mockImplementation(async (command, args) => {
    if (command === 'obsidian_status') return { connected: true, mode: 'adaptive', message: 'ready' };
    if (command === 'list_creative_versions') return [...versions];
    if (command === 'load_creative_version') return versions.find((v) => v.id === args.id);
    if (command === 'list_task_attempts' || command === 'get_provider_model_catalog') return [];
    if (command === 'get_creative_task') return { status: failed ? 'failed' : 'preview_ready', provider: null, events: [] };
    if (command === 'generate_creative' || command === 'save_creative_revision') {
      if (failed) throw new Error('Provider menolak recipe; versi sebelumnya dipertahankan.');
      const req = args.request as { taskId: string; parentVersionId: string | null } | undefined;
      const value: CreativeVersion = {
        id: `fixture-${versions.length + 1}`, taskId: req?.taskId ?? String(args.taskId),
        parentVersionId: req?.parentVersionId ?? args.parentVersionId as string | null,
        document: command === 'save_creative_revision' ? args.document as CreativeVersion['document'] : { kind: 'sky', recipe },
        engineVersion: 1, artifact: { relativePath: 'fixture/recipe.json', sha256: 'a'.repeat(64), byteLength: 1 }, createdAt: '1',
      };
      versions.unshift(value); return value;
    }
    throw new Error(`Unexpected fixture command: ${command}`);
  });
});

describe('SkyboxPage', () => {
  it('renders prompt, editor and preview with honest output limits', async () => {
    render(<SkyboxPage />);
    expect(screen.getByRole('heading', { name: 'Generator Langit' })).toBeVisible();
    expect(screen.getByLabelText('Nama Skybox')).toHaveValue('Langit Senja Keemasan');
    expect(screen.getByRole('region', { name: 'Pratinjau Skybox' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled());
    expect(screen.getByText(/Sambungan cubemap belum divalidasi/)).toBeVisible();
    await waitFor(() => expect(call).toHaveBeenCalledWith('list_creative_versions', { kind: 'sky' }));
  });

  it('switches preview modes and preserves face selection', async () => {
    const user = userEvent.setup(); render(<SkyboxPage />);
    await user.click(screen.getByRole('button', { name: 'Panorama 360°' }));
    expect(screen.getByRole('button', { name: 'Panorama 360°' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Satu Sisi' }));
    await user.click(screen.getByRole('tab', { name: /UP/ }));
    expect(screen.getByRole('tab', { name: /UP/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('changes preset and updates time', async () => {
    const user = userEvent.setup(); render(<SkyboxPage />);
    await selectChoice(screen.getByLabelText('Preset Suasana Langit'), 'night_stars');
    expect(screen.getByText(/Waktu Dunia: 0.5:00/)).toBeVisible();
  });

  it('generates through shared task command, refines chosen parent and reopens after remount', async () => {
    const user = userEvent.setup(); const page = render(<SkyboxPage />);
    await user.click(screen.getByRole('combobox', { name: 'Provider generator' }));
    await user.click(screen.getByRole('option', { name: 'API kompatibel' }));
    await user.click(screen.getByRole('option', { name: /Fixture/ }));
    const prompt = screen.getByLabelText('Apa yang ingin dibuat?');
    await user.clear(prompt); await user.type(prompt, 'Langit senja');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByLabelText('Nama Skybox')).toHaveValue(recipe.name));
    expect(call).toHaveBeenCalledWith('generate_creative', expect.objectContaining({ request: expect.objectContaining({ kind: 'sky', prompt: 'Langit senja', providerId: 'sky-account' }) }));
    await user.type(screen.getByLabelText('Revisi'), 'Ubah warna horizon menjadi biru');
    await user.click(screen.getByRole('button', { name: 'Simpan revisi' }));
    await waitFor(() => expect(versions).toHaveLength(2));
    expect(versions[0].parentVersionId).toBe('fixture-1');
    page.unmount(); render(<SkyboxPage />);
    await waitFor(() => expect(screen.getByLabelText('Nama Skybox')).toHaveValue(recipe.name));
    expect(call).toHaveBeenCalledWith('load_creative_version', { id: 'fixture-2' });
  });

  it('stores manual edits and keeps previous recipe after provider failure', async () => {
    const user = userEvent.setup(); render(<SkyboxPage />);
    await user.click(screen.getByRole('button', { name: 'Simpan versi' }));
    await waitFor(() => expect(versions).toHaveLength(1));
    expect(versions[0].document.kind).toBe('sky');
    await user.click(screen.getByRole('combobox', { name: 'Provider generator' }));
    await user.click(screen.getByRole('option', { name: 'API kompatibel' }));
    await user.click(screen.getByRole('option', { name: /Fixture/ }));
    failed = true;
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Provider menolak recipe'));
    expect(versions).toHaveLength(1);
    expect(screen.getByLabelText('Nama Skybox')).toHaveValue('Langit Senja Keemasan');
  });

  it('handles shortcuts and blocks invalid manual save', async () => {
    window.location.hash = '#create/sky';
    const user = userEvent.setup(); render(<SkyboxPage />);
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByText(/berhasil dirender lokal/)).toBeVisible();
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(versions).toHaveLength(1));
    await user.clear(screen.getByLabelText('Nama Skybox'));
    await user.keyboard('{Control>}s{/Control}');
    expect(versions).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Simpan versi' })).toBeDisabled();
  });

  it('copies Lighting script without claiming textures were applied', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SkyboxPage />);
    await user.click(screen.getAllByRole('button', { name: 'Salin Skrip Luau' })[0]);
    expect(writeText.mock.calls[0][0]).toContain('game:GetService("Lighting")');
    expect(screen.getByText('Skrip Luau Roblox Sky & Lighting disalin ke clipboard.')).toBeVisible();
  });
});
