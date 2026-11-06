import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { McpConnectorConfig } from '@forgekit/contracts';
import * as aiServices from '../../services/ai';
import { McpSettings } from './McpSettings';

const saved: McpConnectorConfig = {
  id: 'mcp-1', name: 'Catatan', transport: 'stdio', command: 'npx', args: ['-y', 'notes-server'],
  isEnabled: true, allowedTools: [], createdAt: '1', updatedAt: '1',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(aiServices, 'listMcpConnectors').mockResolvedValue([saved]);
  vi.spyOn(aiServices, 'saveMcpConnector').mockResolvedValue();
  vi.spyOn(aiServices, 'toggleMcpConnector').mockResolvedValue();
  vi.spyOn(aiServices, 'deleteMcpConnector').mockResolvedValue();
  vi.spyOn(aiServices, 'listAvailableMcpTools').mockResolvedValue([
    { name: 'read_note', description: 'Baca catatan', category: 'Catatan', isWrite: false },
    { name: 'write_note', description: '', category: 'Catatan', isWrite: true },
  ]);
});

it('lists saved connectors and shows the tools a server really exposes', async () => {
  const user = userEvent.setup();
  render(<McpSettings />);
  expect(await screen.findByText('Catatan')).toBeVisible();
  expect(screen.getByText('npx -y notes-server')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Periksa tools' }));
  expect(aiServices.listAvailableMcpTools).toHaveBeenCalledWith(saved);
  expect(await screen.findByText('read_note')).toBeVisible();
  expect(screen.getByText('tulis')).toBeVisible();
});

it('saves a new stdio connector with one argument per line', async () => {
  const user = userEvent.setup();
  render(<McpSettings />);
  await screen.findByText('Catatan');
  await user.type(screen.getByLabelText('Nama'), 'Filesystem');
  await user.type(screen.getByLabelText('Perintah'), 'npx');
  await user.type(screen.getByLabelText('Argumen (satu per baris)'), '-y{enter}@modelcontextprotocol/server-filesystem{enter}/Users/saya/Proyek Roblox');
  await user.type(screen.getByLabelText(/Tool yang diizinkan/), 'read_file, list_directory');
  await user.click(screen.getByRole('button', { name: 'Simpan konektor' }));
  await waitFor(() => expect(aiServices.saveMcpConnector).toHaveBeenCalled());
  const config = vi.mocked(aiServices.saveMcpConnector).mock.calls[0][0];
  expect(config).toMatchObject({
    name: 'Filesystem', transport: 'stdio', command: 'npx', isEnabled: true,
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/saya/Proyek Roblox'],
    allowedTools: ['read_file', 'list_directory'],
  });
  expect(await screen.findByText(/tersimpan dan aktif/)).toBeVisible();
});

it('toggles and deletes a connector', async () => {
  const user = userEvent.setup();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<McpSettings />);
  await user.click(await screen.findByRole('checkbox', { name: 'Aktifkan Catatan' }));
  expect(aiServices.toggleMcpConnector).toHaveBeenCalledWith('mcp-1', false);
  await user.click(screen.getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(aiServices.deleteMcpConnector).toHaveBeenCalledWith('mcp-1'));
});

it('shows server failures instead of hiding them', async () => {
  const user = userEvent.setup();
  vi.mocked(aiServices.listAvailableMcpTools).mockRejectedValueOnce(new Error('Perintah MCP "npx" tidak ditemukan di PATH.'));
  render(<McpSettings />);
  await user.click(await screen.findByRole('button', { name: 'Periksa tools' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('tidak ditemukan di PATH');
});
