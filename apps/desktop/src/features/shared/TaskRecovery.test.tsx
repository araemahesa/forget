import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { TaskRecovery } from './TaskRecovery';
import { call } from '../../services/tauri';
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
vi.mock('../../services/providerState', () => ({ useProviders: () => ({ profiles: [] }) }));
const task = { id: 'task-one', kind: 'chat', threadId: 'thread-one', status: 'interrupted', provider: { profileId: 'account', adapterId: 'openai-compatible', modelId: 'selected' }, recovery: { canFinalize: true, canVerify: true, hasEffects: true, hasUnknownEffects: true, verification: 'not_checked', turnsUsed: 7, turnsLimit: 16, callsUsed: 5, callsLimit: 24 } };
beforeEach(() => { vi.mocked(call).mockReset().mockImplementation(async command => command === 'get_creative_task' ? task : { message: { content: 'Partial result' } }); });
it('shows unknown effects and explicitly finalizes the existing task without resubmitting its prompt', async () => {
  const recovered = vi.fn(); render(<TaskRecovery taskId="task-one" onRecovered={recovered} />);
  expect(await screen.findByText(/Sebagian operasi belum dapat dipastikan/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Selesaikan jawaban' }));
  await waitFor(() => expect(recovered).toHaveBeenCalled());
  expect(call).toHaveBeenCalledWith('resume_ai_task', { id: 'task-one', mode: 'finalize' });
  expect(vi.mocked(call).mock.calls.every(([cmd]) => !['send_chat_message', 'generate_creative'].includes(cmd))).toBe(true);
});
it('offers read-only verification only when native checkpoint permits it', async () => {
  render(<TaskRecovery taskId="task-one" onRecovered={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Periksa hasil tanpa mengulang write' }));
  expect(call).toHaveBeenCalledWith('resume_ai_task', { id: 'task-one', mode: 'verify' });
});
it('does not advertise recovery for a checkpoint with exhausted aggregate counters', async () => {
  vi.mocked(call).mockResolvedValue({ ...task, recovery: { ...task.recovery, canVerify: false, canFinalize: false } });
  render(<TaskRecovery taskId="task-one" onRecovered={vi.fn()} />);
  await screen.findByText(/Sebagian operasi belum dapat dipastikan/);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText(/Tinjau hasil parsial/)).toBeNull();
  expect(screen.queryByText(/Finalisasi tidak tersedia/)).toBeNull();
});
it('rejects a double click while owned and ignores a late response after unmount', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(r => { resolve = r; });
  vi.mocked(call).mockImplementation(async command => command === 'get_creative_task' ? task : pending);
  const recovered = vi.fn(); const busy = vi.fn();
  const view = render(<TaskRecovery taskId="task-one" onRecovered={recovered} onBusyChange={busy} />);
  const button = await screen.findByRole('button', { name: 'Selesaikan jawaban' });
  await userEvent.dblClick(button);
  expect(vi.mocked(call).mock.calls.filter(([cmd]) => cmd === 'resume_ai_task')).toHaveLength(1);
  expect(busy).toHaveBeenCalledWith(true);
  view.unmount(); await act(async () => resolve({ message: {} }));
  expect(recovered).not.toHaveBeenCalled();
});

it('keeps a validated editor candidate available for review after parent conflict or reload', async () => {
  vi.mocked(call).mockResolvedValue({...task, status:'completed', candidate:'{"title":"Provider candidate"}', recovery:{...task.recovery, hasEffects:false, hasUnknownEffects:false, canFinalize:false, canVerify:false, verification:'passed'}});
  render(<TaskRecovery taskId="task-one" showCandidate onRecovered={vi.fn()} />);
  expect(await screen.findByText(/Kandidat provider telah diperiksa/)).toBeVisible();
  expect(screen.getByText('{"title":"Provider candidate"}')).toBeInTheDocument();
  expect(screen.queryByText(/Tugas belum selesai/)).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('allows read-back of unknown map effects after the provider already finished its reply', async () => {
  vi.mocked(call).mockResolvedValue({ ...task, status: 'completed', recovery: { ...task.recovery, canFinalize: false, canVerify: true } });
  render(<TaskRecovery taskId="task-one" onRecovered={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Periksa hasil tanpa mengulang write' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Selesaikan jawaban' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Coba lagi|Lanjutkan proses/ })).toBeNull();
});

it('offers stop Play only for an explicitly resumable native checkpoint', async () => {
  vi.mocked(call).mockImplementation(async command => command === 'get_creative_task' ? { ...task, recovery: { ...task.recovery, canResumeEdit: true, hasUnknownEffects: false } } : { message: {} });
  render(<TaskRecovery taskId="task-one" onRecovered={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Hentikan Play dan lanjutkan' }));
  expect(call).toHaveBeenCalledWith('resume_ai_task', { id: 'task-one', mode: 'stop_play' });
});
