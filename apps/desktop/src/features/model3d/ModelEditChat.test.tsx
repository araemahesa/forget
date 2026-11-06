import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelEditChat } from './ModelEditChat';
import { call } from '../../services/tauri';
const state = vi.hoisted(() => ({ provider: { id: 'saved-account', model: 'chosen-model' } as { id: string; model: string } | null }));
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
vi.mock('../../services/providerUsage', () => ({ loadProviderUsage: vi.fn() }));
vi.mock('../../services/featureSelection', () => ({ useFeatureProviderSelection: () => ({
  provider: state.provider, modelSelection: { modelId: 'chosen-model', effort: 'high' }, profiles: [], connectionProfiles: [], choice: 'saved-account', setChoice: vi.fn(),
}) }));
vi.mock('../shared/ProviderPicker', () => ({ ProviderPicker: () => <span>Provider picker</span> }));
vi.mock('../shared/ModelControls', () => ({ ModelControls: () => <span>Model picker</span> }));
const source = { jobId: 'a'.repeat(32), relativePath: `hunyuan3d/${'a'.repeat(32)}/model.glb`, sha256: 'b'.repeat(64), byteLength: 123, model: 'tencent/Hunyuan3D-2' };
const revised = { ...source, jobId: 'c'.repeat(32), relativePath: `hunyuan3d/${'c'.repeat(32)}/model.glb` };
const props = () => ({ model: source, disabled: false, onBusyChange: vi.fn(), onEdited: vi.fn().mockResolvedValue(undefined) });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); state.provider = { id: 'saved-account', model: 'chosen-model' }; });
afterEach(cleanup);
function type(text = 'Tambahkan topi merah') { fireEvent.change(screen.getByLabelText('Perubahan objek'), { target: { value: text } }); }
it('submits real provider request once and selects only saved revision', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(() => new Promise(done => { resolve = done; }) as never);
  const callbacks = props(); render(<ModelEditChat {...callbacks} />); type();
  const form = screen.getByRole('button', { name: 'Kirim perubahan' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('hunyuan_edit_model', { relativePath: source.relativePath, prompt: 'Tambahkan topi merah', providerId: 'saved-account', modelId: 'chosen-model', reasoningEffort: 'high' });
  expect(callbacks.onEdited).not.toHaveBeenCalled();
  resolve({ model: revised, summary: 'Topi merah ditambahkan; GLB baru tersimpan.' });
  await waitFor(() => expect(callbacks.onEdited).toHaveBeenCalledWith(revised));
  expect(screen.getByText(/GLB baru tersimpan/)).toBeInTheDocument();
  expect(localStorage.getItem(`forgekit:model-edit:${revised.relativePath}`)).toContain('Topi merah');
  expect(callbacks.onBusyChange.mock.calls).toEqual([[true], [false]]);
});
it('keeps draft and source model after provider failure; never reports success', async () => {
  vi.mocked(call).mockRejectedValue(new Error('Provider tidak terhubung.'));
  const callbacks = props(); render(<ModelEditChat {...callbacks} />); type();
  fireEvent.click(screen.getByRole('button', { name: 'Kirim perubahan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider tidak terhubung');
  expect(screen.getByLabelText('Perubahan objek')).toHaveValue('Tambahkan topi merah');
  expect(callbacks.onEdited).not.toHaveBeenCalled();
});
it('blocks missing provider and missing source rather than simulating edits', async () => {
  state.provider = null; const callbacks = props(); const view = render(<ModelEditChat {...callbacks} />); type();
  fireEvent.click(screen.getByRole('button', { name: 'Kirim perubahan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pilih akun dan model AI');
  view.rerender(<ModelEditChat {...callbacks} model={null} />);
  expect(screen.getByRole('button', { name: 'Kirim perubahan' })).toBeDisabled(); expect(call).not.toHaveBeenCalled();
});
it('ignores composing Enter including Safari 229; plain Enter submits', async () => {
  vi.mocked(call).mockResolvedValue({ model: revised, summary: 'Selesai tersimpan.' });
  render(<ModelEditChat {...props()} />); type(); const input = screen.getByLabelText('Perubahan objek');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); expect(call).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' }); await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
});
it('retains saved revision even if preview fails and isolates model conversations', async () => {
  vi.mocked(call).mockResolvedValue({ model: revised, summary: 'Revisi tersimpan.' });
  const callbacks = props(); callbacks.onEdited.mockRejectedValue(new Error('Decode failed'));
  const view = render(<ModelEditChat {...callbacks} />); type(); fireEvent.click(screen.getByRole('button', { name: 'Kirim perubahan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Revisi sudah tersimpan');
  view.rerender(<ModelEditChat {...callbacks} model={revised} />);
  expect(screen.getByText('Revisi tersimpan.')).toBeInTheDocument();
  view.rerender(<ModelEditChat {...callbacks} model={{ ...source, relativePath: 'other-model' }} />);
  await waitFor(() => expect(screen.queryByText('Revisi tersimpan.')).toBeNull());
});

it('does not deliver a stale revision into an unmounted editor', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(() => new Promise(done => { resolve = done; }) as never);
  const callbacks = props(); const view = render(<ModelEditChat {...callbacks} />); type();
  fireEvent.click(screen.getByRole('button', { name: 'Kirim perubahan' })); view.unmount();
  resolve({ model: revised, summary: 'Revisi tersimpan saat halaman ditutup.' });
  await waitFor(() => expect(localStorage.getItem(`forgekit:model-edit:${revised.relativePath}`)).toContain('Revisi tersimpan'));
  expect(callbacks.onEdited).not.toHaveBeenCalled();
});

it('keeps secondary settings collapsed and primary edit controls visible', () => {
  render(<ModelEditChat {...props()} />);
  const settings = screen.getByText('Pengaturan AI').closest('details')!;
  const help = screen.getByText('Info editor').closest('details')!;
  expect(settings).not.toHaveAttribute('open');
  expect(help).not.toHaveAttribute('open');
  expect(screen.getByLabelText('Perubahan objek')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Kirim perubahan' })).toBeVisible();
  expect(screen.getByText(/Prompt, ringkasan objek/)).toBeVisible();
  fireEvent.click(screen.getByText('Pengaturan AI'));
  expect(settings).toHaveAttribute('open');
});
it('keeps only the 20 most recent revision histories in localStorage', async () => {
  const older = Array.from({ length: 20 }, (_, index) => `old/${index}.glb`);
  for (const path of older) localStorage.setItem(`forgekit:model-edit:${path}`, '[]');
  localStorage.setItem('forgekit:model-edit-index', JSON.stringify(older));
  localStorage.setItem('forgekit:model-edit:untracked.glb', '[]');
  vi.mocked(call).mockResolvedValue({ model: revised, summary: 'Selesai tersimpan.' });
  const callbacks = props(); render(<ModelEditChat {...callbacks} />); type();
  fireEvent.click(screen.getByRole('button', { name: 'Kirim perubahan' }));
  await waitFor(() => expect(callbacks.onEdited).toHaveBeenCalledWith(revised));
  const keys = Object.keys(localStorage).filter(key => key.startsWith('forgekit:model-edit:'));
  expect(keys).toHaveLength(20);
  expect(localStorage.getItem('forgekit:model-edit:old/0.glb')).toBeNull();
  expect(localStorage.getItem('forgekit:model-edit:old/1.glb')).toBeNull();
  expect(localStorage.getItem('forgekit:model-edit:untracked.glb')).toBeNull();
  expect(localStorage.getItem(`forgekit:model-edit:${revised.relativePath}`)).toContain('Selesai tersimpan');
  expect(JSON.parse(localStorage.getItem('forgekit:model-edit-index')!).at(-1)).toBe(revised.relativePath);
});
