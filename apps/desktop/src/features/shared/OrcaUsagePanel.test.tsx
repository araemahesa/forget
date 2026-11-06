import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { AiProviderProfile, ConnectionProfile } from '@forgekit/contracts';
import { OrcaUsagePanel } from './OrcaUsagePanel';

vi.mock('../../services/providerUsage', () => ({
  loadProviderUsage: vi.fn(),
  useProviderUsage: (profiles: AiProviderProfile[]) => profiles.map((profile) => ({
    profile, loading: false, error: '', data: {
      profileId: profile.id, status: 'available', source: 'codex', checkedAt: 1793191405,
      observedAt: 1793191405, planType: 'plus', message: null,
      windows: [{ id: '5h', label: '5h', scope: 'ChatGPT', usedPercent: profile.id === 'codex' ? 13 : 41,
        windowDurationMins: 300, resetsAt: 1993200000, remaining: null, limit: null, unit: null }],
    },
  })),
}));

const profiles: AiProviderProfile[] = ['old', 'codex'].map((id) => ({
  id, name: id, providerType: 'openai', baseUrl: 'https://api.openai.com/v1',
  model: 'fixture', keyReference: id, isDefault: id === 'old', createdAt: '1', updatedAt: '1',
}));
const connections = [{ id: 'codex', authMethod: 'codex_oauth' }] as ConnectionProfile[];

it('keeps the user-selected account when a different default is supplied and data rerenders', async () => {
  const user = userEvent.setup();
  const props = { isOpen: true, onClose: vi.fn(), profiles, connections, defaultSelectedId: 'old' };
  const view = render(<OrcaUsagePanel {...props} />);
  await user.click(screen.getByRole('option', { name: /OpenAI · Codex/ }));
  expect(screen.getByRole('option', { name: /OpenAI · Codex/ })).toHaveAttribute('aria-selected', 'true');
  view.rerender(<OrcaUsagePanel {...props} profiles={[...profiles]} />);
  const detail = screen.getByRole('region', { name: 'Rincian kuota dan limit akun' });
  expect(within(detail).getByText('13% terpakai')).toBeInTheDocument();
  expect(within(detail).getByText('Paket: plus')).toBeInTheDocument();
  expect(within(detail).getByRole('link', { name: /Buka Halaman Usage Provider/ })).toHaveAttribute('href', 'https://chatgpt.com/settings/usage');
});

it('closes by Escape, restores focus and shows both connected accounts in its own overlay', async () => {
  const close = vi.fn();
  const user = userEvent.setup();
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const view = render(<OrcaUsagePanel isOpen onClose={close} profiles={profiles} connections={connections} />);
  expect(screen.getByRole('dialog')).toHaveClass('orca-usage-overlay');
  expect(screen.getAllByRole('option')).toHaveLength(2);
  await user.click(screen.getByRole('radio', { name: 'Ringkas' }));
  expect(screen.getByRole('button', { name: 'Tutup panel usage' })).toBeVisible();
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalled();
  view.unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});

it('keeps focus where the user put it when the parent re-renders with a new inline onClose', async () => {
  const user = userEvent.setup();
  const view = render(<OrcaUsagePanel isOpen onClose={() => {}} profiles={profiles} connections={connections} />);
  const codex = screen.getByRole('option', { name: /OpenAI · Codex/ });
  await user.click(codex);
  codex.focus();
  const latest = vi.fn();
  view.rerender(<OrcaUsagePanel isOpen onClose={latest} profiles={profiles} connections={connections} />);
  expect(codex).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(latest).toHaveBeenCalledTimes(1);
});
