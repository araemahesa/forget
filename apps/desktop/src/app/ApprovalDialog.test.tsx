import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ToolApprovalRequest } from '../services/ai';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  pending: [] as ToolApprovalRequest[],
  resolve: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, listener: (event: { payload: unknown }) => void) => { mocks.listeners.set(event, listener); return vi.fn(); }),
}));
vi.mock('../services/ai', () => ({
  listToolApprovals: vi.fn(async () => mocks.pending),
  resolveToolApproval: mocks.resolve,
}));

import { ApprovalDialog } from './ApprovalDialog';

const write: ToolApprovalRequest = {
  taskId: 'task-1', callId: 'call-1', tool: 'forgekit_studio_execute_luau',
  title: 'Ubah map "Obby" di Roblox Studio', preview: 'workspace.Gate:Destroy()', truncated: false,
};

beforeEach(() => {
  mocks.listeners.clear(); mocks.pending = []; mocks.resolve.mockClear();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
});

it('shows the exact change and sends the approval', async () => {
  const user = userEvent.setup();
  render(<ApprovalDialog />);
  await waitFor(() => expect(mocks.listeners.has('forgekit:approval-request')).toBe(true));
  act(() => mocks.listeners.get('forgekit:approval-request')!({ payload: write }));
  expect(await screen.findByRole('heading', { name: write.title })).toBeVisible();
  expect(screen.getByLabelText('Isi perubahan')).toHaveTextContent('workspace.Gate:Destroy()');
  await user.click(screen.getByRole('button', { name: 'Izinkan' }));
  expect(mocks.resolve).toHaveBeenCalledWith('task-1', 'call-1', true);
  await waitFor(() => expect(screen.queryByRole('heading', { name: write.title })).toBeNull());
});

it('rejects and picks up requests raised before it mounted', async () => {
  const user = userEvent.setup();
  mocks.pending = [write];
  render(<ApprovalDialog />);
  expect(await screen.findByRole('heading', { name: write.title })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Tolak' }));
  expect(mocks.resolve).toHaveBeenCalledWith('task-1', 'call-1', false);
});

it('drops a request the task already resolved elsewhere', async () => {
  render(<ApprovalDialog />);
  await waitFor(() => expect(mocks.listeners.has('forgekit:approval-resolved')).toBe(true));
  act(() => mocks.listeners.get('forgekit:approval-request')!({ payload: write }));
  expect(await screen.findByRole('heading', { name: write.title })).toBeVisible();
  act(() => mocks.listeners.get('forgekit:approval-resolved')!({ payload: { taskId: 'task-1', callId: 'call-1' } }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: write.title })).toBeNull());
  expect(mocks.resolve).not.toHaveBeenCalled();
});
