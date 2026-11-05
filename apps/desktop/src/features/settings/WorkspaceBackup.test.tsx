import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceBackup } from './WorkspaceBackup';
import { createWorkspaceBackup, listWorkspaceBackups, restoreWorkspaceBackup, verifyWorkspaceBackup } from '../../services/tauri';
import { flushPendingDraft } from '../gfx/useGfxDraft';

vi.mock('../../services/tauri', () => ({
  createWorkspaceBackup: vi.fn(), listWorkspaceBackups: vi.fn(),
  restoreWorkspaceBackup: vi.fn(), verifyWorkspaceBackup: vi.fn(),
}));
vi.mock('../gfx/useGfxDraft', () => ({ flushPendingDraft: vi.fn() }));
const backup = { id: 'backup-123', directory: '/local/backups/backup-123', artifactCount: 2, byteLength: 1024, createdAt: '1793000000000' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listWorkspaceBackups).mockResolvedValue([backup]);
  vi.mocked(flushPendingDraft).mockResolvedValue(undefined);
});

it('flushes draft before backup and reports verified recovery destination', async () => {
  vi.mocked(createWorkspaceBackup).mockResolvedValue(backup);
  vi.mocked(verifyWorkspaceBackup).mockResolvedValue(backup);
  vi.mocked(restoreWorkspaceBackup).mockResolvedValue('/local/recovered/recovery-456');
  const user = userEvent.setup();
  render(<WorkspaceBackup />);
  await user.click(screen.getByRole('button', { name: 'Buat backup workspace' }));
  expect(await screen.findByText('Backup dibuat: /local/backups/backup-123')).toBeVisible();
  expect(vi.mocked(flushPendingDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createWorkspaceBackup).mock.invocationCallOrder[0]);
  await user.click(screen.getByRole('button', { name: 'Verifikasi backup' }));
  expect(await screen.findByText(/Backup terverifikasi/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Pulihkan sebagai salinan' }));
  expect(await screen.findByText(/Salinan pemulihan siap: \/local\/recovered\/recovery-456/)).toBeVisible();
  expect(restoreWorkspaceBackup).toHaveBeenCalledWith(backup.id);
});

it('blocks backup when draft cannot be flushed and displays native errors without success', async () => {
  vi.mocked(flushPendingDraft).mockRejectedValue(new Error('Disk penuh'));
  const user = userEvent.setup();
  render(<WorkspaceBackup />);
  await user.click(screen.getByRole('button', { name: 'Buat backup workspace' }));
  expect(await screen.findByText('Disk penuh')).toBeVisible();
  expect(createWorkspaceBackup).not.toHaveBeenCalled();
  expect(screen.queryByText(/Backup dibuat:/)).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Verifikasi backup' })).toBeEnabled());
  vi.mocked(verifyWorkspaceBackup).mockRejectedValue(new Error('Hash artefak tidak cocok'));
  await user.click(screen.getByRole('button', { name: 'Verifikasi backup' }));
  expect(await screen.findByText('Hash artefak tidak cocok')).toBeVisible();
  expect(screen.queryByText(/Backup terverifikasi/)).toBeNull();
});
