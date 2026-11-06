import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { call } from '../../services/tauri';
import { readReference } from '../../services/references';
import { disposeGeometry } from '../create/geometry';
import { HunyuanPanel } from './HunyuanPanel';

vi.mock('./ModelEditChat', () => ({ ModelEditChat: ({ onEdited }: { onEdited: (value: unknown) => Promise<void> }) => <button type="button" onClick={() => void onEdited({ relativePath: `hunyuan3d/${'c'.repeat(32)}/model.glb`, jobId: 'c'.repeat(32), parentJobId: 'a'.repeat(32), byteLength: 2048 })}>Finish verified AI revision</button> }));
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
vi.mock('../../services/references', () => ({ readReference: vi.fn() }));
vi.mock('../create/ThreeViewport', () => ({ ThreeViewport: () => <div>GLB viewport</div> }));
vi.mock('../create/geometry', () => ({ disposeGeometry: vi.fn() }));
vi.mock('./hunyuanPreview', async importOriginal => ({ ...await importOriginal<typeof import('./hunyuanPreview')>(), loadHunyuanPreview: vi.fn(async () => new Group()) }));
const id = 'a'.repeat(32);
const receipt = { relativePath: `hunyuan3d/${id}/model.glb`, sha256: 'b'.repeat(64), byteLength: 1024, model: 'tencent/Hunyuan3D-2', jobId: id };
let ready = true;
let pollStatus = 'succeeded';
let pollError = false;
let saveError = false;
let savedModels: typeof receipt[] = [];
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); ready = true; pollStatus = 'succeeded'; pollError = false; saveError = false; savedModels = [];
  vi.mocked(readReference).mockResolvedValue({ name: 'cat.png', dataUrl: 'data:image/png;base64,UE5H' });
  vi.mocked(call).mockImplementation(async command => {
    if (command === 'obsidian_status') return { connected: true, message: 'Panduan tersedia' } as never;
    if (command === 'hunyuan_load_config') return { endpoint: 'http://127.0.0.1:8765', hasToken: true, configured: true } as never;
    if (command === 'hunyuan_list_models') return savedModels as never;
    if (command === 'hunyuan_health') return { ready, cuda_available: ready, model: 'tencent/Hunyuan3D-2' } as never;
    if (command === 'hunyuan_start') return { id, status: 'queued' } as never;
    if (command === 'hunyuan_poll') { if (pollError) throw new Error('Worker tidak dapat dijangkau.'); return { id, status: pollStatus } as never; }
    if (command === 'hunyuan_cancel') return { id, status: 'cancelled' } as never;
    if (command === 'hunyuan_download') { if (saveError) throw new Error('Penyimpanan gagal.'); return receipt as never; }
    if (command === 'hunyuan_open_blender') return undefined as never;
    if (command === 'hunyuan_load_model') return { base64: 'Z2xi' } as never;
    throw new Error(`Unexpected command ${command}`);
  });
});
async function loaded() {
  render(<HunyuanPanel active />);
  await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('hunyuan_load_config', {}));
}
async function selectImage() {
  fireEvent.change(screen.getByLabelText(/Gambar referensi/), { target: { files: [new File(['image'], 'cat.png', { type: 'image/png' })] } });
  await screen.findByAltText('Referensi: cat.png');
}
it('removes GPU connection controls without changing saved connection', async () => {
  await loaded();
  expect(screen.queryByText('Koneksi GPU')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Endpoint worker')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Token akses/)).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Hapus token tersimpan' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Simpan koneksi' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tes koneksi tersimpan' })).not.toBeInTheDocument();
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'hunyuan_save_config')).toBe(false);
});
it('blocks generation when worker is not ready; never falls back to procedural', async () => {
  ready = false; await loaded(); await selectImage();
  fireEvent.submit(screen.getByRole('button', { name: 'Buat 3D dengan Hunyuan' }).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Worker belum siap');
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'hunyuan_start')).toBe(false);
  expect(vi.mocked(call).mock.calls.every(([command]) => command.startsWith('hunyuan_') || command === 'obsidian_status')).toBe(true);
});
it('uploads one PNG, persists completed job until model is saved, and loads native GLB', async () => {
  await loaded(); await selectImage();
  expect(screen.queryByRole('checkbox', { name: 'Buat tekstur' })).toBeNull();
  await waitFor(() => expect(call).toHaveBeenCalledWith('obsidian_status', {}));
  expect(screen.queryByText(/Obsidian terhubung/)).toBeNull();
  fireEvent.submit(screen.getByRole('button', { name: 'Buat 3D dengan Hunyuan' }).closest('form')!);
  const save = await screen.findByRole('button', { name: 'Simpan & pratinjau GLB' });
  expect(call).toHaveBeenCalledWith('hunyuan_start', { imageBase64: 'UE5H', seed: 0, steps: 30, texture: true });
  expect(JSON.parse(localStorage.getItem('forgekit:hunyuan:pending')!)).toEqual({ id, endpoint: 'http://127.0.0.1:8765' });
  fireEvent.click(save);
  await waitFor(() => expect(call).toHaveBeenCalledWith('hunyuan_load_model', { relativePath: receipt.relativePath }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Buka di Blender' })).toBeEnabled());
  expect(localStorage.getItem('forgekit:hunyuan:pending')).toBeNull();
});
it('restores persisted running job and cancels it', async () => {
  localStorage.setItem('forgekit:hunyuan:pending', JSON.stringify({ id, endpoint: 'http://127.0.0.1:8765' })); pollStatus = 'running';
  await loaded();
  fireEvent.click(await screen.findByRole('button', { name: 'Batalkan job' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('hunyuan_cancel', { id }));
  await waitFor(() => expect(localStorage.getItem('forgekit:hunyuan:pending')).toBeNull());
  expect(await screen.findByText('Dibatalkan')).toBeInTheDocument();
});
it('rejects non-image upload without calling attachment processing', async () => {
  await loaded();
  fireEvent.change(screen.getByLabelText(/Gambar referensi/), { target: { files: [new File(['bad'], 'code.js', { type: 'text/javascript' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Pilih satu gambar');
  expect(readReference).not.toHaveBeenCalled();
});
it('disposes loaded scene on unmount and opens saved gallery without remote requests', async () => {
  savedModels = [receipt];
  const view = render(<HunyuanPanel active />);
  fireEvent.click(await screen.findByRole('button', { name: /Hunyuan aaaaaaaa/ }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('hunyuan_load_model', { relativePath: receipt.relativePath }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Hunyuan aaaaaaaa/ })).toBeEnabled());
  view.unmount();
  expect(disposeGeometry).toHaveBeenCalledWith(expect.any(Group));
  expect(vi.mocked(call).mock.calls.every(([command]) => ['hunyuan_load_config', 'hunyuan_list_models', 'hunyuan_load_model', 'obsidian_status'].includes(command))).toBe(true);
});
it('restores completed pending result and preserves it after failed local save', async () => {
  localStorage.setItem('forgekit:hunyuan:pending', JSON.stringify({ id, endpoint: 'http://127.0.0.1:8765' })); saveError = true;
  await loaded();
  fireEvent.click(await screen.findByRole('button', { name: 'Simpan & pratinjau GLB' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Penyimpanan gagal');
  expect(JSON.parse(localStorage.getItem('forgekit:hunyuan:pending')!)).toEqual({ id, endpoint: 'http://127.0.0.1:8765' });
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'hunyuan_start')).toBe(false);
});
it('pauses on poll error; confirmed local detach unlocks generation without claiming remote cancel', async () => {
  localStorage.setItem('forgekit:hunyuan:pending', JSON.stringify({ id, endpoint: 'http://127.0.0.1:8765' })); pollError = true;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await loaded();
  expect(await screen.findByRole('alert')).toHaveTextContent('Worker tidak dapat dijangkau');
  expect(screen.getByRole('button', { name: 'Buat 3D dengan Hunyuan' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Lepaskan job lokal' }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('tidak membatalkan job'));
  expect(screen.getByRole('button', { name: 'Buat 3D dengan Hunyuan' })).toBeEnabled();
  expect(localStorage.getItem('forgekit:hunyuan:pending')).toBeNull();
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'hunyuan_cancel')).toBe(false);
});
it('retry resumes explicit status check without submitting another generation', async () => {
  localStorage.setItem('forgekit:hunyuan:pending', JSON.stringify({ id, endpoint: 'http://127.0.0.1:8765' })); pollError = true;
  await loaded();
  await screen.findByRole('alert'); pollError = false;
  fireEvent.click(screen.getByRole('button', { name: 'Coba status lagi' }));
  expect(await screen.findByRole('button', { name: 'Simpan & pratinjau GLB' })).toBeEnabled();
  expect(vi.mocked(call).mock.calls.filter(([command]) => command === 'hunyuan_poll')).toHaveLength(2);
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'hunyuan_start')).toBe(false);
});
it('does not poll or cancel a pending job against a different endpoint', async () => {
  localStorage.setItem('forgekit:hunyuan:pending', JSON.stringify({ id, endpoint: 'https://different.example' }));
  await loaded();
  expect(await screen.findByRole('alert')).toHaveTextContent('Endpoint job berbeda');
  expect(vi.mocked(call).mock.calls.some(([command]) => ['hunyuan_poll', 'hunyuan_cancel', 'hunyuan_download'].includes(command))).toBe(false);
  expect(screen.queryByRole('button', { name: 'Batalkan job' })).not.toBeInTheDocument();
});

it('uses saved AI revision for preview and Blender while retaining source in history', async () => {
  savedModels = [receipt]; await loaded();
  fireEvent.click(await screen.findByRole('button', { name: /Hunyuan aaaaaaaa/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Buka di Blender' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Finish verified AI revision' }));
  const revisedPath = `hunyuan3d/${'c'.repeat(32)}/model.glb`;
  await waitFor(() => expect(call).toHaveBeenCalledWith('hunyuan_load_model', { relativePath: revisedPath }));
  expect(await screen.findByRole('button', { name: /Revisi AI cccccccc/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Hunyuan aaaaaaaa/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Buka di Blender' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('hunyuan_open_blender', { relativePath: revisedPath }));
});
