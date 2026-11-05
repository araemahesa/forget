import { selectChoice } from '../../tests/selectChoice';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderSettings } from './ProviderSettings';
import * as aiServices from '../../services/ai';
import type { ConnectionProfile, FallbackPolicy, RouterConnection } from '@forgekit/contracts';

const mockProfiles: ConnectionProfile[] = [
  {
    id: 'prof-1',
    providerId: 'openai',
    connectionMode: 'direct',
    credentialOwner: 'forgekit',
    authMethod: 'api_key',
    label: 'OpenAI Akun Utama',
    credentialRef: 'key-1',
    accessState: 'ready',
    enabled: true,
    fallbackEligible: 'supported',
    priority: 0,
    quotaBucketRefs: ['prof-1'],
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    isDefault: true,
    createdAt: '1700000000',
    updatedAt: '1700000000',
  },
  {
    id: 'prof-2',
    providerId: 'antigravity-9router',
    connectionMode: 'router',
    credentialOwner: 'router',
    routerInstanceId: 'default-9router',
    authMethod: 'router_dashboard',
    label: 'Antigravity Cadangan',
    accessState: 'ready',
    enabled: true,
    fallbackEligible: 'unknown',
    priority: 1,
    quotaBucketRefs: ['prof-2'],
    baseUrl: 'http://127.0.0.1:20128/v1',
    model: 'ag/fixture-model',
    isDefault: false,
    createdAt: '1700000000',
    updatedAt: '1700000000',
  },
];

const mockPolicy: FallbackPolicy = {
  id: 'policy-1',
  enabled: false,
  orderedProfileIds: [],
  allowedProviderIds: ['openai', 'claude', 'antigravity-9router', 'google-gemini'],
  allowCrossProvider: false,
  allowModelChange: false,
  routingOwner: 'forgekit',
  maxAttempts: 2,
  maxElapsedMs: 60000,
};

const mockRouter: RouterConnection = {
  id: 'default-9router',
  kind: '9router',
  baseUrl: 'http://127.0.0.1:20128',
  dashboardUrl: 'http://127.0.0.1:20128',
  inferenceCredentialRef: '9router-inference-key',
  managementAccess: 'unknown',
  routingOwner: 'router',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(aiServices, 'listConnectionProfiles').mockResolvedValue(mockProfiles);
  vi.spyOn(aiServices, 'getFallbackPolicy').mockResolvedValue(mockPolicy);
  vi.spyOn(aiServices, 'getRouterConnection').mockResolvedValue(mockRouter);
  vi.spyOn(aiServices, 'saveConnectionProfile').mockResolvedValue();
  vi.spyOn(aiServices, 'deleteConnectionProfile').mockResolvedValue();
  vi.spyOn(aiServices, 'setPrimaryProfile').mockResolvedValue();
  vi.spyOn(aiServices, 'saveFallbackPolicy').mockResolvedValue();
  vi.spyOn(aiServices, 'saveRouterConnection').mockResolvedValue();
  vi.spyOn(aiServices, 'probeRouterModels').mockResolvedValue({
    models: ['ag/fixture-model', 'other/model'], managementAccess: 'unknown', upstreamState: 'unknown',
    detectedVersion: '0.5.111', message: 'Router terhubung. Login upstream belum teramati.',
  });
  vi.spyOn(aiServices, 'cancelProviderBrowser').mockResolvedValue();
  vi.spyOn(aiServices, 'connectProviderBrowser').mockResolvedValue({
    sessionId: 'session-fixture', mode: 'router', expiresAt: '', providerId: 'antigravity-9router', status: 'awaiting_verification',
    authUrl: 'http://127.0.0.1:20128/dashboard/providers/antigravity',
    message: 'Selesaikan login di dashboard.',
  });
  vi.spyOn(aiServices, 'testConnectionProfile').mockResolvedValue({
    ok: true,
    latencyMs: 140,
    message: 'Streaming selesai.',
  });
  vi.spyOn(aiServices, 'testRouterConnection').mockResolvedValue({
    ok: true,
    latencyMs: 50,
    message: '9router terhubung (12 model).',
    modelCount: 12,
  });
});

describe('ProviderSettings Component', () => {
  it('renders provider catalog cards and Antigravity notice', async () => {
    render(<ProviderSettings />);

    expect(screen.getByRole('heading', { name: 'Provider AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah koneksi' })).toBeInTheDocument();

    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Antigravity')).toBeInTheDocument();
    expect(screen.getByText('Google / Gemini')).toBeInTheDocument();

    // Verify Antigravity deprecation notice
    expect(screen.getByText('Dukungan terbatas')).toBeInTheDocument();
  });

  it('does not silently enroll saved accounts into fallback', async () => {
    render(<ProviderSettings />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI Akun Utama')).toBeInTheDocument();
      expect(screen.getByText('Antigravity Cadangan')).toBeInTheDocument();
    });

    expect(screen.queryByText('Utama')).toBeNull();
    expect(screen.getAllByText('Tersimpan').length).toBeGreaterThan(0);
    expect(within(document.querySelector('.accounts-list') as HTMLElement).getByText('via 9router')).toBeVisible();
  });

  it('allows testing a connected account', async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI Akun Utama')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: 'Uji koneksi' });
    await user.click(testButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Uji koneksi berhasil \(140ms\): Streaming selesai\./)).toBeInTheDocument();
    });
  });

  it('selects an account for new tasks without promoting a primary', async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await waitFor(() => {
      expect(screen.getByText('Antigravity Cadangan')).toBeInTheDocument();
    });

    const setPrimaryBtn = screen.getAllByRole('button', { name: 'Pakai akun' })[0];
    await user.click(setPrimaryBtn);

    expect(aiServices.setPrimaryProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dipilih' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows disconnecting an account', async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await waitFor(() => {
      expect(screen.getByText('Antigravity Cadangan')).toBeInTheDocument();
    });

    const disconnectButtons = screen.getAllByRole('button', { name: 'Putuskan' });
    await user.click(disconnectButtons[1]);

    expect(aiServices.deleteConnectionProfile).toHaveBeenCalledWith('prof-2');
  });

  it('keeps tasks on the selected account and removes automatic fallback controls', async () => {
    render(<ProviderSettings />);
    await screen.findByText('OpenAI Akun Utama');
    expect(screen.queryByRole('checkbox', { name: 'Fallback otomatis' })).toBeNull();
    expect(aiServices.saveFallbackPolicy).not.toHaveBeenCalled();
  });

  it('opens connect modal for Antigravity via 9router with guidance and test controls', async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await screen.findByText('Antigravity Cadangan');
    const card = screen.getByText('Antigravity', { exact: true }).closest('.provider-card')!;
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Tambah akun' }));

    expect(screen.getByRole('heading', { name: 'Hubungkan Antigravity · via 9router' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Buka 9router di Browser' }));
    expect(aiServices.connectProviderBrowser).toHaveBeenCalledWith('antigravity-9router');
    expect(aiServices.testConnectionProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Periksa koneksi' }));
    const model = screen.getByRole('combobox', { name: 'Model tersedia' });
    await user.click(model);
    expect(await screen.findByRole('option', { name: 'ag/fixture-model' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'other/model' })).not.toBeInTheDocument();
    expect(aiServices.saveConnectionProfile).not.toHaveBeenCalled();
    await selectChoice(model, 'ag/fixture-model');
    await user.click(screen.getByRole('button', { name: 'Simpan & Periksa akses' }));
    await waitFor(() => expect(aiServices.testConnectionProfile).toHaveBeenCalledWith(expect.objectContaining({
      connectionMode: 'router', credentialOwner: 'router', credentialRef: undefined, model: 'ag/fixture-model',
    })));
  });

  it.each(['OpenAI', 'Google / Gemini'])('opens %s in the browser without mounting the API form', async (name) => {
    const user = userEvent.setup(); render(<ProviderSettings />);
    await screen.findByText('OpenAI Akun Utama');
    const card = screen.getByText(name, { exact: true }).closest('.provider-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: name === 'OpenAI' ? 'Tambah akun' : 'Connect' }));
    expect(aiServices.connectProviderBrowser).toHaveBeenCalledWith(name === 'OpenAI' ? 'openai' : 'google-gemini', undefined, expect.any(String));
    expect(screen.queryByRole('textbox', { name: 'Model' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Kunci API (disimpan di Keychain)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Token Sesi Web')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login ChatGPT standar' })).not.toBeInTheDocument();
    expect(aiServices.saveConnectionProfile).not.toHaveBeenCalled();
  });

  it('allows cancelling a pending browser login', async () => {
    let complete!: (value: Awaited<ReturnType<typeof aiServices.connectProviderBrowser>>) => void;
    vi.mocked(aiServices.connectProviderBrowser).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const user = userEvent.setup(); const view = render(<ProviderSettings />);
    await screen.findByText('OpenAI Akun Utama');
    const card = screen.getByText('OpenAI', { exact: true }).closest('.provider-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Tambah akun' }));
    await user.click(screen.getByRole('button', { name: 'Batalkan login' }));
    expect(aiServices.cancelProviderBrowser).toHaveBeenCalledWith(expect.any(String));
    complete({sessionId:'fixture',providerId:'openai',mode:'direct',authUrl:'',status:'cancelled',expiresAt:'',message:'Login dibatalkan.'});
    await screen.findByText('Login dibatalkan.'); view.unmount();
  });

  it('keeps failed inference pending and clears API input before waiting', async () => {
    vi.mocked(aiServices.testConnectionProfile).mockResolvedValue({ ok: false, latencyMs: 20, message: 'Model ditolak.' });
    const user = userEvent.setup();
    render(<ProviderSettings />);
    await screen.findByText('OpenAI Akun Utama');
    const card = screen.getByText('Claude', { exact: true }).closest('.provider-card')!;
    const connect = within(card as HTMLElement).getByRole('button', { name: 'Koneksi API lanjutan untuk Claude' });
    await user.click(connect);
    await user.type(screen.getByRole('textbox', { name: 'Model' }), 'fixture');
    const input = screen.getByLabelText('Kunci API (disimpan di Keychain)');
    await user.type(input, 'fixture-not-a-real-key');
    await user.click(screen.getByRole('button', { name: 'Simpan & Periksa akses' }));
    expect(await screen.findByText(/Akses belum terverifikasi: Model ditolak/)).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(aiServices.saveConnectionProfile).toHaveBeenCalledWith(expect.objectContaining({
      accessState: 'pending', credentialRef: expect.stringMatching(/^provider-/),
    }), 'fixture-not-a-real-key');
    expect(aiServices.connectProviderBrowser).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(connect).toHaveFocus();
  });
});

it('opens a new Claude API account form from the main action, preserving saved accounts', async () => {
  render(<ProviderSettings />);
  await screen.findByText('OpenAI Akun Utama');
  const card = screen.getByText('Claude', { exact: true }).closest('.provider-card') as HTMLElement;
  await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
  expect(screen.getByLabelText('Nama akun')).toHaveValue('Claude · Akun 1');
  expect(screen.getByLabelText('Kunci API (disimpan di Keychain)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Buka Claude Console' })).toBeInTheDocument();
  expect(screen.getByText('OpenAI Akun Utama')).toBeInTheDocument();
  expect(aiServices.deleteConnectionProfile).not.toHaveBeenCalled();
});
