import { resetImageMocks } from '../imageTestSupport';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { GfxPage } from '../gfx/GfxPage';
import { IconsPage } from '../icons/IconsPage';
import { ClothingPage } from '../clothing/ClothingPage';
import { SfxPage } from '../sfx/SfxPage';
import { generateEditorRecipe } from '../../services/editorAi';
import { synthesizeSfx } from '../../engines/sfx/dsp';
import { synthesizeSfxAsync } from '../../engines/sfx/worker';

vi.mock('../../services/featureSelection', () => ({ useFeatureProviderSelection: () => ({
  provider: { id: 'fixture' }, profiles: [], connectionProfiles: [], choice: 'fixture',
  modelSelection: { modelId: 'fixture-model' }, snapshot: () => ({ providerType: 'fixture', modelId: 'fixture-model' }),
}) }));
vi.mock('./ProviderPicker', () => ({ ProviderPicker: () => null }));
vi.mock('./ModelControls', () => ({ ModelControls: () => null }));
vi.mock('./OrcaUsagePanel', () => ({ OrcaUsagePanel: () => null }));
vi.mock('./TaskAttempts', () => ({ TaskAttempts: () => null }));
vi.mock('./TaskRecovery', () => ({ TaskRecovery: () => null }));
vi.mock('../../services/editorAi', () => ({ generateEditorRecipe: vi.fn() }));
vi.mock('../../services/tauri', async (original) => ({
  ...await original<typeof import('../../services/tauri')>(),
  call: vi.fn().mockResolvedValue({ connected: true, message: 'Vault fixture', projects: [] }),
  loadGfxDraft: vi.fn().mockResolvedValue(null), saveGfxDraft: vi.fn().mockImplementation(async (spec, baselineVersionId, revision) => ({ spec, baselineVersionId, revision: revision + 1 })),
  listGfxVersions: vi.fn().mockResolvedValue([]), getWorkspaceInfo: vi.fn().mockResolvedValue({ rootPath: '/fixture', orphanArtifacts: [] }),
}));
vi.mock('../../services/sfx', () => ({ listSfxVersions: vi.fn().mockResolvedValue([]) }));
vi.mock('../../engines/sfx/worker', () => ({ synthesizeSfxAsync: vi.fn() }));

beforeEach(() => {
  localStorage.clear(); resetImageMocks();
  vi.mocked(synthesizeSfxAsync).mockImplementation(async (recipe) => synthesizeSfx(recipe));
  vi.mocked(generateEditorRecipe).mockImplementation(async (request) => ({
    taskId: request.taskId ?? 'fixture', source: 'fixture',
    spec: { ...request.currentSpec as object, ...(request.kind === 'gfx' ? { title: 'AI fixture' } : { name: 'AI fixture' }) },
  }));
});

it.each([
  ['gfx', GfxPage, 'Judul', '#gfx-preview .svg-frame svg'],
  ['icon', IconsPage, 'Nama ikon', '.icon-hero-frame svg'],
  ['clothing', ClothingPage, 'Nama pakaian', '.clothing-hero-frame svg'],
  ['sfx', SfxPage, 'Nama efek suara', '.sfx-waveform-display'],
] as const)('connects %s prompt to provider and renders the returned specification', async (kind, Page, label, preview) => {
  render(<Page />);
  fireEvent.change(screen.getByLabelText('Prompt instruksi AI'), { target: { value: 'Perbaiki hasil sesuai brief' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Susun' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Susun' }));
  await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue('AI fixture'));
  expect(generateEditorRecipe).toHaveBeenCalledWith(expect.objectContaining({ kind, currentSpec: expect.any(Object) }));
  expect(await screen.findByText(/Pratinjau diperbarui/)).toBeVisible();
  expect(document.querySelector(preview)).not.toBeNull();
  if (kind === 'sfx') expect(synthesizeSfxAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'AI fixture' }), expect.any(AbortSignal));
});

it('keeps a newer manual edit when a provider returns late', async () => {
  let finish!: (value: never) => void;
  vi.mocked(generateEditorRecipe).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<IconsPage />);
  fireEvent.change(screen.getByLabelText('Prompt instruksi AI'), { target: { value: 'ubah ikon' } });
  fireEvent.click(screen.getByRole('button', { name: 'Susun' }));
  fireEvent.change(screen.getByLabelText('Nama ikon'), { target: { value: 'Edit terbaru' } });
  await act(async () => finish({ spec: {} } as never));
  expect(screen.getByLabelText('Nama ikon')).toHaveValue('Edit terbaru');
  expect(await screen.findByRole('alert')).toHaveTextContent('Editor berubah selama proses');
});

it('reports synthesis failure without replacing the existing draft or claiming preview success', async () => {
  vi.mocked(synthesizeSfxAsync).mockRejectedValue(new Error('Worker gagal'));
  render(<SfxPage />);
  fireEvent.change(screen.getByLabelText('Prompt instruksi AI'), { target: { value: 'suara angin' } });
  fireEvent.click(screen.getByRole('button', { name: 'Susun' }));
  await waitFor(() => expect(screen.getAllByText('Worker gagal').length).toBeGreaterThan(0));
  expect(screen.getByLabelText('Nama efek suara')).toHaveValue('Tembakan Laser Sci-Fi');
  expect(screen.queryByText(/Pratinjau diperbarui/)).toBeNull();
});

it('cancels the audio engine before applying a generated draft', async () => {
  let renderSignal: AbortSignal | undefined;
  vi.mocked(synthesizeSfxAsync).mockImplementation((_recipe, signal) => {
    renderSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Sintesis dibatalkan')), { once: true }));
  });
  render(<SfxPage />);
  fireEvent.change(screen.getByLabelText('Prompt instruksi AI'), { target: { value: 'suara angin' } });
  fireEvent.click(screen.getByRole('button', { name: 'Susun' }));
  await waitFor(() => expect(renderSignal).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(renderSignal?.aborted).toBe(true));
  expect(screen.getByLabelText('Nama efek suara')).toHaveValue('Tembakan Laser Sci-Fi');
  expect(screen.queryByText(/Pratinjau diperbarui/)).toBeNull();
});
