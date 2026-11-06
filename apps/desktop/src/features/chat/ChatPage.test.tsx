import { selectChoice } from '../../tests/selectChoice';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { setStudioSnapshot } from '../../services/studioState';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), load: vi.fn(), latest: vi.fn(), send: vi.fn(), cancel: vi.fn(),
  provider: { id: 'profile-one', name: 'Provider satu', model: 'configured-model', providerType: 'local-llm', baseUrl: 'http://127.0.0.1:1234/v1' },
  chunk: null as null | ((event: { payload: unknown }) => void),
  tool: null as null | ((event: { payload: unknown }) => void),
  discord: null as null | { id: string; username: string; displayName: string; avatarUrl: string },
}));
vi.mock('../../services/studioState', async (original) => { const actual = await original<typeof import('../../services/studioState')>(); return { ...actual, refreshStudioContext: vi.fn(async () => actual.getStudioSnapshot()) }; });
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, listener: typeof mocks.chunk) => {
    if (event === 'forgekit:ai-chunk') mocks.chunk = listener;
    if (event === 'forgekit:ai-tool') mocks.tool = listener;
    return vi.fn();
  }),
}));
vi.mock('../../services/providerState', () => ({ useProviders: () => ({ profiles: [mocks.provider], defaultProvider: mocks.provider }) }));
vi.mock('../../services/tauri', () => ({ call: vi.fn(async (command: string) => command === 'get_provider_model_catalog' ? [{ id: 'configured-model', displayName: 'Configured', reasoningEfforts: ['low', 'medium', 'high'] }, { id: 'other-model', displayName: 'Other', reasoningEfforts: ['low', 'high'] }] : []) }));
vi.mock('../../services/accountState', () => ({ useDiscordAccount: () => ({ account: { profile: mocks.discord } }) }));
vi.mock('../../services/ai', () => ({
  listChatThreads: mocks.list, createChatThread: mocks.create, loadChatThread: mocks.load,
  sendChatMessage: mocks.send, cancelChatStream: mocks.cancel, deleteChatThread: vi.fn(),
  latestChatTurn: mocks.latest, listTaskAttempts: vi.fn(async () => []),
}));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const answer = { id: 'assistant-one', threadId: 'thread-one', role: 'assistant', content: 'Jawaban tersimpan', createdAt: '1' };
it('keeps cold-launch empty state at top when welcome content exceeds viewport', async () => {
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
  try {
    render(<ChatPage onOpenVersion={vi.fn()} />);
    await screen.findByRole('heading', { name: /Apa yang ingin kamu buat/ });
    expect(screen.getByRole('log').scrollTop).toBe(0);
  } finally { height.mockRestore(); }
});
beforeEach(() => {
  localStorage.removeItem('forgekit:active-chat'); localStorage.removeItem('forgekit:chat-draft');
  vi.clearAllMocks(); mocks.provider.model = 'configured-model'; mocks.chunk = null; mocks.tool = null;
  mocks.discord = null;
  setStudioSnapshot(null);
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: 'thread-one', title: 'Percakapan', model: 'configured-model' });
  mocks.load.mockResolvedValue([answer]); mocks.cancel.mockResolvedValue(undefined);
  mocks.latest.mockResolvedValue(null);
});
async function start() {
  render(<ChatPage onOpenVersion={vi.fn()} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Input pesan chat'), 'Pertanyaan');
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  return user;
}

it('uses the logged-in Discord identity for user messages and ForgeKit branding for assistant and activity', async () => {
  mocks.discord = { id: '123456789012345678', username: 'ari', displayName: 'Ari Discord', avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png' };
  mocks.load.mockResolvedValue([
    { ...answer, id: 'user-one', role: 'user', content: '**Prompt pengguna**' },
    { ...answer, content: '## Hasil\n\n- Selesai' },
    { ...answer, id: 'activity-one', role: 'tool', content: 'Membaca map' },
  ]);
  mocks.send.mockResolvedValue(answer);
  await start();
  expect(await screen.findByText('Ari Discord')).toBeVisible();
  expect(screen.getByText('**Prompt pengguna**').querySelector('strong')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Hasil' })).toBeVisible();
  const messages = screen.getByRole('log').querySelectorAll('.chat-message-row');
  expect(messages[0].querySelector('img')).toHaveAttribute('src', mocks.discord.avatarUrl);
  expect(messages[1].querySelector('img')).toHaveAttribute('src', '/branding/app-icon.svg');
  expect(messages).toHaveLength(2);
  expect(screen.queryByText('Membaca map')).toBeNull();
});

it('captures provider for running request and waits for native persistence', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValue(pending.promise);
  await start();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.send.mock.calls[0][2].model).toBe('configured-model');
  mocks.provider.model = 'next-model';
  expect(mocks.send.mock.calls[0][2].model).toBe('configured-model');
  await act(async () => pending.resolve(answer));
  expect(await screen.findByText('Jawaban tersimpan')).toBeVisible();
  expect(screen.getByLabelText('Input pesan chat')).toHaveValue('');
});

it('streams a live draft for the active request only and completes on the native receipt', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValue(pending.promise);
  await start();
  const requestId = mocks.send.mock.calls[0][3] as string;
  act(() => {
    mocks.chunk?.({ payload: { threadId: 'thread-one', requestId: 'stale', chunk: 'Salah', done: false } });
    mocks.chunk?.({ payload: { threadId: 'thread-one', requestId, chunk: 'Akun lama', done: false } });
    mocks.chunk?.({ payload: { threadId: 'thread-one', requestId, chunk: '', done: false, reset: true } });
    mocks.chunk?.({ payload: { threadId: 'thread-one', requestId, chunk: 'Sedang ', done: false } });
    mocks.chunk?.({ payload: { threadId: 'thread-one', requestId, chunk: 'streaming', done: false } });
  });
  expect(screen.queryByText('Salah')).toBeNull();
  expect(screen.queryByText('Akun lama')).toBeNull();
  expect(screen.getByText('Sedang streaming')).toBeVisible();
  expect(screen.getByText(/draf belum tersimpan/)).toBeVisible();
  act(() => { mocks.chunk?.({ payload: { threadId: 'thread-one', requestId, chunk: '', done: true } }); });
  // A terminal stream event alone never completes the task.
  expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  await act(async () => pending.resolve(answer));
  expect(await screen.findByText('Jawaban tersimpan')).toBeVisible();
  expect(screen.queryByText('Sedang streaming')).toBeNull();
});

it('reloads committed messages when Stop races with a completed native response', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValue(pending.promise);
  const user = await start();
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  await act(async () => pending.resolve(answer));
  expect(await screen.findByText('Jawaban tersimpan')).toBeVisible();
  expect(screen.getByText(/^Stop diterima/)).toHaveAttribute('role', 'status');
});

it('keeps failed input and reloads persisted user history after stream failure', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValue(pending.promise);
  mocks.load.mockResolvedValue([{ ...answer, id: 'user-one', role: 'user', content: 'Pertanyaan tersimpan' }]);
  await start();
  await act(async () => pending.reject(new Error('Stream terputus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Stream terputus');
  expect(screen.getByLabelText('Input pesan chat')).toHaveValue('Pertanyaan');
  expect(screen.getByText('Pertanyaan tersimpan')).toBeVisible();
});

it('starts a distinct task when a user resubmits after failure, without replaying the old checkpoint', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValueOnce(pending.promise);
  const user = await start();
  const requestId = mocks.send.mock.calls[0][3] as string;
  mocks.latest.mockResolvedValue({
    id: requestId, kind: 'chat', threadId: 'thread-one', prompt: 'Pertanyaan', mode: 'auto',
    provider: { profileId: mocks.provider.id, adapterId: 'local-llm', modelId: mocks.provider.model, endpoint: mocks.provider.baseUrl, reasoningEffort: 'high' },
    status: 'failed', error: 'Stream terputus',
  });
  await act(async () => pending.reject(new Error('Stream terputus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Stream terputus');
  expect(screen.getByLabelText('Input pesan chat')).toHaveValue('Pertanyaan');
  mocks.send.mockResolvedValueOnce(answer);
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
  expect(mocks.send.mock.calls[1][3]).not.toBe(requestId);
});

it('automatically attaches detected map context and locks it for the running task', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValue(pending.promise);
  const context = {
    id: 'snapshot-one', studioId: 'target-one', displayName: 'Place', scope: 'game', depth: 2,
    observedAt: String(Date.now()), loadedNodes: 1, truncated: false,
    nodes: [{ name: 'Gate', className: 'Model', children: [] }], contentHash: 'a'.repeat(64), skillHash: 'b'.repeat(64),
  };
  setStudioSnapshot({ studio: { studioId: 'target-one', name: 'Place', placeId: null }, checkedAt: context.observedAt, context });
  render(<ChatPage onOpenVersion={vi.fn()} />);
  const user = userEvent.setup();
  expect(screen.queryByRole('checkbox')).toBeNull();
  await user.type(screen.getByLabelText('Input pesan chat'), 'Jelaskan Gate');
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  expect(mocks.send.mock.calls[0][4]).toBe('auto');
  expect(mocks.send.mock.calls[0][6]).toBe('target-one');
  expect(mocks.send.mock.calls[0][5]).toBe('snapshot-one');
  act(() => setStudioSnapshot(null));
  expect(mocks.send.mock.calls[0][5]).toBe('snapshot-one');
  await act(async () => pending.resolve(answer));
});

it('preserves snapshot tool receipts and opens the live Explorer without treating snapshot references as live IDs', async () => {
  const pending = deferred<typeof answer>(); mocks.send.mockReturnValue(pending.promise);
  const context = {
    id: 'snapshot-one', studioId: 'target-one', displayName: 'Place', scope: 'game', depth: 2,
    observedAt: String(Date.now()), loadedNodes: 1, truncated: false,
    nodes: [{ name: 'Gate', className: 'Model', children: [] }], contentHash: 'a'.repeat(64), skillHash: 'b'.repeat(64),
  };
  setStudioSnapshot({ studio: { studioId: 'target-one', name: 'Place', placeId: null }, checkedAt: context.observedAt, context });
  const user = await start();
  const requestId = mocks.send.mock.calls[0][3] as string;
  const receipt = {
    callId: 'call-1', name: 'map.search', implementationVersion: '1.0.0',
    snapshotId: 'snapshot-one', contentHash: 'a'.repeat(64), requestHash: 'b'.repeat(64),
    observedAt: context.observedAt, completedAt: String(Date.now()), readOnly: true, truncated: false,
    matches: [{ reference: 'node/0', name: 'Gate', className: 'Model', childCount: 0 }],
  };
  act(() => {
    mocks.tool?.({ payload: { threadId: 'thread-one', requestId, receipt } });
  });
  await user.click(await screen.findByText('Diagnostik pembacaan'));
  const summary = await screen.findByText(/map\.search · 1 referensi/);
  expect(summary).toBeVisible();
  await user.click(summary);
  const matchButton = screen.getByRole('button', { name: /Gate · Model · node\/0/ });
  await user.click(matchButton);
  expect(screen.getByRole('tree', { name: 'Hierarki Studio live' })).toBeVisible();
  expect(screen.queryByRole('listitem', { current: true })).toBeNull();
  await act(async () => pending.resolve(answer));
});

it('passes the selected model and effort to the native chat request', async () => {
  mocks.send.mockResolvedValue(answer);
  render(<ChatPage onOpenVersion={vi.fn()} />);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText('Model AI')).toBeEnabled());
  await selectChoice(screen.getByLabelText('Model AI'), 'other-model');
  await selectChoice(screen.getByLabelText('Tingkat penalaran AI'), 'high');
  await user.type(screen.getByLabelText('Input pesan chat'), 'Gunakan model pilihan');
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  expect(mocks.send.mock.calls[0][2]).toMatchObject({ id: 'profile-one', model: 'other-model', reasoningEffort: 'high' });
});

it('shows prompt and Discord profile immediately while thread creation is still pending, without a mode selector', async () => {
  mocks.discord = { id: '123456789012345678', username: 'ari', displayName: 'Ari Discord', avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png' };
  const pending = deferred<{ id: string; title: string; model: string }>();
  mocks.create.mockReturnValueOnce(pending.promise); mocks.send.mockResolvedValue(answer);
  const user = userEvent.setup(); render(<ChatPage onOpenVersion={vi.fn()} />);
  await user.type(screen.getByLabelText('Input pesan chat'), 'Buat gerbang');
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
  expect(screen.getByText('Buat gerbang', { selector: '.chat-user-content' })).toBeVisible();
  expect(screen.getByText('Ari Discord')).toBeVisible();
  expect(screen.queryByLabelText('Mode percakapan')).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ id: 'thread-one', title: 'Gerbang', model: 'configured-model' }));
  await screen.findByText('Jawaban tersimpan');
});


it('restores the same durable running turn after navigation without sending again', async () => {
  localStorage.setItem('forgekit:active-chat', 'thread-one');
  mocks.load.mockResolvedValue([{ ...answer, id: 'user', role: 'user', content: 'Prompt tersimpan' }]);
  mocks.latest.mockResolvedValue({ id: 'running-turn', status: 'tool_running', threadId: 'thread-one' });
  const view=render(<ChatPage onOpenVersion={vi.fn()} />);
  expect(await screen.findByText('Prompt tersimpan')).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
  view.unmount();
  mocks.latest.mockResolvedValue({ id: 'running-turn', status: 'completed', threadId: 'thread-one' });
  mocks.load.mockResolvedValue([{ ...answer, content: 'Hasil final tersimpan' }]);
  render(<ChatPage onOpenVersion={vi.fn()} />);
  expect(await screen.findByText('Hasil final tersimpan')).toBeVisible();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('opens the live map explorer from the folder beside new chat without a duplicate library control', async () => {
  const { call } = await import('../../services/tauri');
  const user = userEvent.setup();
  render(<ChatPage onOpenVersion={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Karya tersimpan' })).toBeNull();
  const folder = screen.getByRole('button', { name: 'Explorer map' });
  expect(folder.previousElementSibling).toHaveAccessibleName('Percakapan baru');
  await user.click(folder);
  expect(screen.getByRole('complementary', { name: 'Explorer map' })).toBeVisible();
  expect(screen.queryByRole('tree')).toBeNull();
  act(() => setStudioSnapshot({ studio: { studioId: 'live-map', name: 'Live map', placeId: null }, checkedAt: '1' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('read_studio_explorer', expect.objectContaining({ studioId: 'live-map', query: expect.objectContaining({ action: 'children', path: [] }) })));
  expect(screen.getByRole('tree', { name: 'Hierarki Studio live' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Explorer map bersama' })).toBeNull();
});

it('sends plain chat without a Studio target when the map snapshot is not verified', async () => {
  mocks.send.mockResolvedValue(answer);
  setStudioSnapshot({ studio: { studioId: 'unverified-map', name: 'Place', placeId: null }, checkedAt: '1' });
  await start();
  expect(mocks.send.mock.calls[0][5]).toBeUndefined();
  expect(mocks.send.mock.calls[0][6]).toBeUndefined();
});

it('sends the chosen read-only mode and remembers it', async () => {
  mocks.send.mockResolvedValue(answer);
  localStorage.removeItem('forgekit:chat-mode');
  render(<ChatPage onOpenVersion={vi.fn()} />);
  const user = userEvent.setup();
  await selectChoice(screen.getByRole('combobox', { name: 'Mode kerja' }), 'ask');
  await user.type(screen.getByLabelText('Input pesan chat'), 'Jelaskan map ini');
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  expect(mocks.send.mock.calls[0][4]).toBe('ask');
  expect(localStorage.getItem('forgekit:chat-mode')).toBe('ask');
});
