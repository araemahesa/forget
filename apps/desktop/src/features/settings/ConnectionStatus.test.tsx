import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectionStatus } from './ConnectionStatus';
import { call, probeStudio, readStudio, captureStudioContext, type StudioReport } from '../../services/tauri';
import { refreshStudioContext, setStudioSnapshot } from '../../services/studioState';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../../services/tauri', () => ({ call: vi.fn(), probeStudio: vi.fn(), readStudio: vi.fn(), captureStudioContext: vi.fn() }));
const report = (studios: StudioReport['studios']): StudioReport => ({ executable: 'StudioMCP', checkedAt: '1', protocolVersion: '2025-06-18', serverName: 'Studio', studios, readTools: [] });
beforeEach(() => {
  vi.resetAllMocks(); localStorage.removeItem('forgekit:studio-target'); setStudioSnapshot(null);
  vi.mocked(readStudio).mockResolvedValue({ content: [{ text: 'Current Studio Mode: Edit' }] });
  vi.mocked(captureStudioContext).mockRejectedValue(new Error('Tanpa konteks'));
});

it('shows Studio and Blender connecting by themselves, with no form or approval controls', async () => {
  vi.mocked(call).mockResolvedValue({ available: true });
  vi.mocked(probeStudio).mockResolvedValue(report([{ studioId: 'one', name: 'Obby Hutan', placeId: 7 }]));
  render(<ConnectionStatus />);
  await act(async () => { await refreshStudioContext(); });
  expect(screen.getByText('Tersambung ke "Obby Hutan"')).toBeInTheDocument();
  expect(await screen.findByText('Terdeteksi · dipakai untuk Model 3D')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByLabelText('Map tujuan')).toBeNull();
});

it('explains what to open when Studio or Blender are missing, and offers a switch when several maps are open', async () => {
  vi.mocked(call).mockResolvedValue({ available: false });
  vi.mocked(probeStudio).mockResolvedValue(report([]));
  render(<ConnectionStatus />);
  await act(async () => { await refreshStudioContext(); });
  expect(screen.getByText(/Buka Roblox Studio dan sebuah place/)).toBeInTheDocument();
  expect(await screen.findByText(/Blender belum|Belum terdeteksi/)).toBeInTheDocument();
  vi.mocked(probeStudio).mockResolvedValue(report([{ studioId: 'a', name: 'Map A', placeId: 1 }, { studioId: 'b', name: 'Map B', placeId: 2 }]));
  await act(async () => { await refreshStudioContext(); });
  expect(screen.getByText('Tersambung ke "Map A" · 2 map terbuka')).toBeInTheDocument();
  expect(screen.getByLabelText('Map tujuan')).toBeInTheDocument();
});
