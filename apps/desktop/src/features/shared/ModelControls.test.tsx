import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { AiProviderProfile } from '@forgekit/contracts';
import { useModelSelection } from '../../services/modelCatalog';
import { ModelControls } from './ModelControls';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../services/tauri', () => ({ call: invoke }));
const account: AiProviderProfile = { id: 'inline-access-fixture', name: 'Selected account', providerType: 'openai', model: 'chosen-model', baseUrl: 'https://api.openai.com/v1', keyReference: 'fixture', isDefault: true, createdAt: '1', updatedAt: '1' };
function Controls() {
  const selection = useModelSelection(account);
  return <><ModelControls selection={selection} /><output aria-label="Model siap">{selection.provider?.model}</output></>;
}
it('recovers locked model controls directly in place without changing account', async () => {
  invoke.mockRejectedValueOnce(new Error('[KEYCHAIN_LOCKED] macOS permission'));
  invoke.mockResolvedValueOnce([{ id: account.model, displayName: 'Chosen model', reasoningEfforts: ['high'] }]);
  render(<Controls />);
  const action = await screen.findByRole('button', { name: 'Izinkan akses akun' });
  expect(screen.getByRole('combobox', { name: 'Model AI' })).toBeDisabled();
  await userEvent.click(action);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model AI' })).toBeEnabled());
  expect(invoke).toHaveBeenCalledWith('get_provider_model_catalog', { profileId: account.id, authorize: true });
  expect(invoke).toHaveBeenCalledWith('get_provider_usage', { profileId: account.id });
  expect(screen.getByLabelText('Model siap')).toHaveTextContent(account.model);
  expect(screen.queryByRole('button', { name: 'Izinkan akses akun' })).toBeNull();
});

it('uses a newly available account without an extra authorization action', async () => {
  const fresh = { ...account, id: 'new-account-ready', model: 'fresh-model' };
  invoke.mockResolvedValue([{ id: fresh.model, displayName: 'Fresh model', reasoningEfforts: [] }]);
  function FreshControls() { return <ModelControls selection={useModelSelection(fresh)} />; }
  render(<FreshControls />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model AI' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Izinkan akses akun' })).toBeNull();
  expect(invoke).toHaveBeenCalledWith('get_provider_model_catalog', { profileId: fresh.id });
  expect(invoke).not.toHaveBeenCalledWith('get_provider_model_catalog', { profileId: fresh.id, authorize: true });
});
