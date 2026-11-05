import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { listGfxTasks, type GfxTaskSummary } from '../../services/tauri';
import { ActivityPage } from './ActivityPage';
import { listWorkTasks, type WorkTask } from '../../services/creatorWorkspace';
import { cancelCreatorTask } from '../../services/creatorTasks';

vi.mock('../../services/tauri', () => ({ listGfxTasks: vi.fn() }));
vi.mock('../../services/creatorWorkspace', async (load) => ({ ...await load<typeof import('../../services/creatorWorkspace')>(), listWorkTasks: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/creatorTasks', () => ({ cancelCreatorTask: vi.fn() }));
const completed: GfxTaskSummary = {
  id: 'task-1', inputVersionId: 'input-1', outputVersionId: 'gfx-1',
  title: 'Karya tersimpan', status: 'succeeded', error: null, updatedAt: '1793000000000',
};
beforeEach(() => {
  vi.mocked(listGfxTasks).mockReset();
  vi.mocked(listWorkTasks).mockReset().mockResolvedValue([]);
  vi.mocked(cancelCreatorTask).mockReset();
});

it('shows persisted outcomes, errors, and opens actual output versions', async () => {
  vi.mocked(listGfxTasks).mockResolvedValue([
    completed,
    { ...completed, id: 'task-2', status: 'interrupted', title: 'Karya terputus', outputVersionId: null, error: 'Aplikasi berhenti sebelum tugas selesai' },
  ]);
  const onOpen = vi.fn();
  render(<ActivityPage activities={[]} onOpen={onOpen} />);
  const history = await screen.findByLabelText('Tugas tersimpan');
  expect(within(history).getByText('Selesai · GFX Creator')).toBeVisible();
  expect(within(history).getByText('Terputus · GFX Creator')).toBeVisible();
  expect(within(history).getByText('Aplikasi berhenti sebelum tugas selesai')).toBeVisible();
  expect(within(history).getAllByRole('button')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Buka hasil Karya tersimpan' }));
  expect(onOpen).toHaveBeenCalledWith('gfx-1', 'gfx');
});

it('reports storage errors and retries without claiming empty history', async () => {
  vi.mocked(listGfxTasks).mockRejectedValueOnce(new Error('SQLite tidak dapat dibuka')).mockResolvedValueOnce([]);
  render(<ActivityPage activities={[]} onOpen={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('SQLite tidak dapat dibuka');
  expect(screen.queryByText('Belum ada tugas pada filter ini.')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  expect(await screen.findByText('Belum ada tugas pada filter ini.')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('refreshes pending tasks and cancels polling when unmounted', async () => {
  vi.mocked(listGfxTasks).mockResolvedValueOnce([{ ...completed, status: 'queued', outputVersionId: null }]).mockResolvedValueOnce([completed]);
  const page = render(<ActivityPage activities={[]} onOpen={vi.fn()} />);
  expect(await screen.findByText('Mengantre · GFX Creator')).toBeVisible();
  await waitFor(() => expect(screen.getByText('Selesai · GFX Creator')).toBeVisible(), { timeout: 2500 });
  page.unmount();
  expect(listGfxTasks).toHaveBeenCalledTimes(2);
});

it('shows creator checkpoints and partial receipt; cancellation stays requested until acknowledged', async () => {
  const task: WorkTask = {
    id: 'work-1', kind: 'sfx', action: 'export', input: { name: 'Suara uji' }, engineVersion: 1,
    status: 'running', stage: 'exporting', receipt: { versionId: 'sfx-1' }, error: null,
    createdAt: '1793000000000', updatedAt: '1793000000000',
    events: [{ sequence: 1, status: 'running', stage: 'version_saved', receipt: { versionId: 'sfx-1' }, createdAt: '1793000000000' }],
  };
  vi.mocked(listGfxTasks).mockResolvedValue([]);
  vi.mocked(listWorkTasks).mockResolvedValue([task]);
  vi.mocked(cancelCreatorTask).mockImplementation(async () => {
    const requested = { ...task, status: 'cancel_requested' as const };
    vi.mocked(listWorkTasks).mockResolvedValue([requested]);
    return requested;
  });
  const onOpen = vi.fn();
  render(<ActivityPage activities={[]} onOpen={onOpen} />);
  await userEvent.click(await screen.findByText('Tahap dan receipt'));
  expect(screen.getByText('Versi tersimpan')).toBeVisible();
  expect(screen.getByText(/"versionId": "sfx-1"/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Buka hasil Ekspor: Suara uji' }));
  expect(onOpen).toHaveBeenCalledWith('sfx-1', 'sfx');
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan' }));
  expect(cancelCreatorTask).toHaveBeenCalledWith('work-1');
  expect(await screen.findByText('Pembatalan diminta · Efek suara · Ekspor')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Batalkan' })).toBeDisabled();
});
