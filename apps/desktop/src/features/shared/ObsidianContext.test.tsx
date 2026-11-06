import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ObsidianContext } from './ObsidianContext';
import { call } from '../../services/tauri';
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
beforeEach(() => vi.mocked(call).mockReset());
it('works silently when connected: no status line and no selector', async () => {
  vi.mocked(call).mockResolvedValue({ connected: true, mode: 'adaptive', message: 'ready', skillCount:25, learnedSkillCount:3, learningEnabled:true });
  render(<ObsidianContext />);
  await waitFor(() => expect(call).toHaveBeenCalledWith('obsidian_status', {}));
  expect(screen.queryByRole('combobox')).toBeNull();
  await waitFor(() => expect(screen.queryByText(/Obsidian terhubung/)).toBeNull());
  expect(screen.queryByRole('status')).toBeNull();
  expect(vi.mocked(call).mock.calls.every(([command]) => command === 'obsidian_status')).toBe(true);
});
it('shows learning failure separately from a working connection and refreshes after tasks', async () => {
  vi.mocked(call).mockResolvedValueOnce({connected:true,message:'ready',learningError:'Folder hanya baca'}).mockResolvedValueOnce({connected:true,message:'ready',learnedSkillCount:2,learningEnabled:true});
  render(<ObsidianContext />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Pembelajaran Obsidian tertunda: Folder hanya baca');
  expect(screen.queryByText(/Obsidian terhubung/)).toBeNull();
  fireEvent(window,new Event('forgekit:tasks-changed'));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
it('reports a real vault failure and clears it after successful refresh', async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error('Catatan tidak ditemukan')).mockResolvedValueOnce({ connected: true, message: 'ready' });
  render(<ObsidianContext />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Catatan tidak ditemukan');
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('reports missing configuration without offering a global brief', async () => {
  vi.mocked(call).mockResolvedValue({ connected: false, message: 'Vault belum dikonfigurasi' });
  render(<ObsidianContext />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Vault belum dikonfigurasi');
  expect(screen.queryByRole('combobox')).toBeNull();
});
