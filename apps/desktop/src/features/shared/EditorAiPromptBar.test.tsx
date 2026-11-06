import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EditorAiPromptBar } from './EditorAiPromptBar';
import { generateEditorRecipe } from '../../services/editorAi';
import { call } from '../../services/tauri';

vi.mock('../../services/featureSelection', () => ({ useFeatureProviderSelection: () => ({
  provider: { id: 'fixture' }, profiles: [], connectionProfiles: [], choice: 'fixture', fallbackNotice: '',
  modelSelection: { modelId: 'fixture-model' }, snapshot: () => ({ providerType: 'fixture', modelId: 'fixture-model' }),
}) }));
vi.mock('./ProviderPicker', () => ({ ProviderPicker: () => null }));
vi.mock('./ModelControls', () => ({ ModelControls: () => null }));
vi.mock('./OrcaUsagePanel', () => ({ OrcaUsagePanel: () => null }));
vi.mock('./TaskAttempts', () => ({ TaskAttempts: () => null }));
vi.mock('./TaskRecovery', () => ({ TaskRecovery: () => null }));
vi.mock('./ObsidianContext', () => ({ ObsidianContext: () => null }));
vi.mock('../../services/providerUsage', () => ({ refreshUsageAfterTask: vi.fn() }));
vi.mock('../../services/editorAi', () => ({ generateEditorRecipe: vi.fn() }));
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));

const parentKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('forgekit:editor-parent:'));
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });

it('drops untracked parent snapshots on mount and removes the snapshot once a result is applied', async () => {
  localStorage.setItem('forgekit:editor-parent:orphan', '{}');
  localStorage.setItem('forgekit:editor-task:icon', 'tracked');
  localStorage.setItem('forgekit:editor-parent:tracked', '{}');
  vi.mocked(call).mockResolvedValue({ id: 'tracked', status: 'failed' });
  vi.mocked(generateEditorRecipe).mockImplementation(async (request) => ({ taskId: request.taskId!, source: 'fixture', spec: { name: 'AI' } }));
  const onApplySpec = vi.fn();
  render(<EditorAiPromptBar kind="gfx" currentSpec={{ name: 'awal' }} onApplySpec={onApplySpec} />);
  expect(parentKeys()).toEqual(['forgekit:editor-parent:tracked']);
  fireEvent.change(screen.getByLabelText('Prompt instruksi AI'), { target: { value: 'ubah' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Susun' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Susun' }));
  expect(await screen.findByText(/Pratinjau diperbarui/)).toBeVisible();
  expect(onApplySpec).toHaveBeenCalledTimes(1);
  expect(parentKeys()).toEqual(['forgekit:editor-parent:tracked']);
});

it('keeps working when localStorage is full', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Penuh', 'QuotaExceededError'); });
  render(<EditorAiPromptBar kind="gfx" currentSpec={{}} onApplySpec={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Prompt instruksi AI'), { target: { value: 'ubah' } });
  expect(screen.getByLabelText('Prompt instruksi AI')).toHaveValue('ubah');
  setItem.mockRestore();
});

it('disables Stop during the initial recovery check and reports cancellation failures', async () => {
  localStorage.setItem('forgekit:editor-task:gfx', 'saved');
  let answer!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === 'get_creative_task') return new Promise((resolve) => { answer = resolve; });
    throw new Error('Koneksi terputus');
  });
  render(<EditorAiPromptBar kind="gfx" currentSpec={{}} onApplySpec={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  await act(async () => { answer({ id: 'saved', status: 'streaming' }); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pembatalan gagal: Koneksi terputus');
});
