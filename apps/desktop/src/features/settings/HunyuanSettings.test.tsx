import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { call } from '../../services/tauri';
import { HunyuanSettings } from './HunyuanSettings';

vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
let saved = { endpoint: 'http://127.0.0.1:8765/', hasToken: false, configured: false };

beforeEach(() => {
  saved = { endpoint: 'http://127.0.0.1:8765/', hasToken: false, configured: false };
  vi.mocked(call).mockReset().mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'hunyuan_load_config') return saved;
    if (command === 'hunyuan_save_config') { saved = { endpoint: String(args.endpoint), hasToken: !!args.token || saved.hasToken, configured: !!args.token || saved.hasToken }; return saved; }
    if (command === 'hunyuan_health') return { ready: true, cuda_available: true };
    throw new Error(`unexpected ${command}`);
  });
});

it('saves endpoint and token, then tests the worker', async () => {
  const user = userEvent.setup();
  render(<HunyuanSettings />);
  const endpoint = await screen.findByLabelText('Endpoint worker');
  await waitFor(() => expect(endpoint).toHaveValue('http://127.0.0.1:8765/'));
  expect(screen.getByRole('button', { name: 'Tes koneksi' })).toBeDisabled();
  await user.type(screen.getByLabelText('Token akses'), 'a'.repeat(40));
  await user.click(screen.getByRole('button', { name: 'Simpan koneksi' }));
  expect(call).toHaveBeenCalledWith('hunyuan_save_config', { endpoint: 'http://127.0.0.1:8765/', token: 'a'.repeat(40) });
  expect(await screen.findByText('Koneksi worker tersimpan.')).toBeVisible();
  expect(screen.getByLabelText('Token akses')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Tes koneksi' }));
  expect(await screen.findByText('Worker siap · GPU CUDA aktif.')).toBeVisible();
});

it('keeps the stored token when the field is left empty and shows backend errors', async () => {
  const user = userEvent.setup();
  saved = { endpoint: 'https://gpu.example.com/', hasToken: true, configured: true };
  render(<HunyuanSettings />);
  expect(await screen.findByPlaceholderText('Kosongkan untuk mempertahankan token tersimpan')).toBeInTheDocument();
  vi.mocked(call).mockRejectedValueOnce(new Error('Endpoint berubah; masukkan token tujuan baru agar token lama tidak terkirim ke server lain.'));
  const endpoint = screen.getByLabelText('Endpoint worker');
  await user.clear(endpoint);
  await user.type(endpoint, 'https://other.example.com/');
  await user.click(screen.getByRole('button', { name: 'Simpan koneksi' }));
  expect(call).toHaveBeenLastCalledWith('hunyuan_save_config', { endpoint: 'https://other.example.com/', token: null });
  expect(await screen.findByRole('alert')).toHaveTextContent('Endpoint berubah');
});
