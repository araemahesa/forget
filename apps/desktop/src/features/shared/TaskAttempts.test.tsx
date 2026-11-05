import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TaskAttempts, taskStage } from './TaskAttempts';
import { call } from '../../services/tauri';
import { listTaskAttempts, type AttemptSummary } from '../../services/ai';

vi.mock('../../services/tauri', () => ({ call: vi.fn(async () => null) }));
vi.mock('../../services/ai', () => ({ listTaskAttempts: vi.fn() }));
vi.mock('../../services/providerState', () => ({ useProviders: () => ({
  profiles: [{ id: 'b', name: 'Akun kerja' }],
}) }));

it('shows actual fallback account and ignores delayed history from previous task', async () => {
  let resolveOld!: (rows: AttemptSummary[]) => void;
  vi.mocked(listTaskAttempts).mockImplementation((id) => id === 'old'
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Promise.resolve([
      { id: 'a1', profileId: 'a', providerId: 'openai', modelId: 'fixture', status: 'rate_limited', startedAt: '1' },
      { id: 'a2', profileId: 'b', providerId: 'openai', modelId: 'fixture', status: 'succeeded', startedAt: '2' },
    ]));
  const { rerender } = render(<TaskAttempts taskId="old" running={false} />);
  rerender(<TaskAttempts taskId="new" running={false} />);
  fireEvent.click(await screen.findByText('Rincian proses'));
  expect(await screen.findByText('Akun kerja · fixture · Selesai')).toBeVisible();
  await act(async () => resolveOld([]));
  await waitFor(() => expect(screen.getByText('Akun kerja · fixture · Selesai')).toBeVisible());
  expect(screen.getByText('Koneksi tersimpan · fixture · Batas sementara')).toBeVisible();
});


it('maps only observed backend stages and never invents completion', () => {
  expect(taskStage('planning')).toBe('Menyiapkan');
  expect(taskStage('reading_context')).toBe('Membaca konteks');
  expect(taskStage('streaming')).toBe('Membuat');
  expect(taskStage('validating')).toBe('Memeriksa');
  expect(taskStage('repairing')).toBe('Menyempurnakan');
  expect(taskStage('saving')).toBe('Menyimpan');
  expect(taskStage('unknown')).toBe('Hasil belum terverifikasi');
  expect(taskStage(undefined)).toBe('Menunggu status');
  expect(taskStage('future_stage')).toBe('Menunggu status');
});


it('uses durable candidate state and cannot regress from final to an older progress revision', async () => {
  vi.mocked(listTaskAttempts).mockResolvedValue([]);
  vi.mocked(call).mockResolvedValue({ activity: { taskId: 'candidate', revision: 4, type: 'candidate', stage: 'validating' }, events: [] });
  const { rerender }=render(<TaskAttempts taskId="candidate" running />);
  expect(await screen.findByRole('status')).toHaveTextContent('Memeriksa');
  vi.mocked(call).mockResolvedValue({ activity: { taskId: 'candidate', revision: 5, type: 'final', stored: true }, events: [] });
  rerender(<TaskAttempts taskId="candidate" running={false} />);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  vi.mocked(call).mockResolvedValue({ activity: { taskId: 'candidate', revision: 3, type: 'progress', stage: 'streaming' }, events: [] });
  rerender(<TaskAttempts taskId="candidate" running />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Selesai'));
  expect(screen.queryByText('Membuat')).toBeNull();
});

it('shows observed model steps without raw request errors or the generic instruction paragraph', async () => {
  vi.mocked(listTaskAttempts).mockResolvedValue([{ id: 'failed', profileId: 'b', providerId: 'openai', modelId: 'fixture', status: 'failed', startedAt: '1', error: '[REQUEST_TIMEOUT] raw diagnostic' }]);
  vi.mocked(call).mockResolvedValue({ status: 'failed', events: [
    { sequence: 1, stage: 'queued', createdAt: '1000' },
    { sequence: 2, stage: 'planning', createdAt: '2000' },
    { sequence: 3, stage: 'failed', createdAt: '3000' },
  ] });
  render(<TaskAttempts taskId="model-failed" running={false} visual />);
  expect(await screen.findByText('Proses terhenti')).toBeVisible();
  expect(screen.getByText('Prompt diterima')).toBeVisible();
  expect(screen.getByText('Menyiapkan model')).toBeVisible();
  expect(screen.queryByText(/raw diagnostic/)).toBeNull();
  expect(screen.queryByText(/Skills ForgeKit/)).toBeNull();
  expect(screen.queryByText('Model tersimpan')).toBeNull();
});
