import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderUsageDetails } from './ProviderUsageDetails';
import type { ProviderUsage } from '../../services/providerUsage';
const now = new Date('2026-10-28T04:00:00Z').getTime();
const data: ProviderUsage = { profileId: 'a', status: 'available', source: 'provider_api', checkedAt: now / 1000, observedAt: now / 1000, planType: 'plus', message: null,
  windows: [{ id: '5h', label: '5h', scope: 'ChatGPT', usedPercent: 85, windowDurationMins: 300, resetsAt: now / 1000 + 3600, remaining: null, limit: null, unit: null },
    { id: 'week', label: 'Mingguan', scope: 'ChatGPT', usedPercent: 40, windowDurationMins: 10080, resetsAt: now / 1000 + 432000, remaining: null, limit: null, unit: null }] };
afterEach(() => vi.useRealTimers());
it('shows used percentages like the account usage panel, with real reset dates', () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  render(<ProviderUsageDetails data={data} loading={false} error="" />);
  expect(screen.getByText('Penggunaan')).toBeInTheDocument();
  expect(screen.getByLabelText('85% terpakai')).toHaveTextContent('85% terpakai');
  expect(screen.getByLabelText('85% terpakai')).toHaveClass('is-warn');
  expect(screen.getByLabelText('40% terpakai')).toHaveTextContent('40% terpakai');
  expect(document.querySelectorAll('.provider-usage-row time')).toHaveLength(2);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not show expired observations as current capacity', () => {
  vi.useFakeTimers(); vi.setSystemTime(now + 7200000);
  render(<ProviderUsageDetails data={data} loading={false} error="" />);
  expect(screen.queryByLabelText('85% terpakai')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Menunggu data terbaru')).toHaveTextContent('—');
  expect(screen.getByLabelText('40% terpakai')).toHaveTextContent('40% terpakai');
});
it('uses the same rows for API/project quotas and does not invent their reset time', () => {
  render(<ProviderUsageDetails data={{ ...data, source: 'google_monitoring', windows: [{ ...data.windows[0], label: 'Permintaan API', scope: 'Project bersama', usedPercent: 25, resetsAt: null, remaining: 150, limit: 200 }] }} loading={false} error="" />);
  expect(screen.getByLabelText('25% terpakai')).toBeInTheDocument();
  expect(screen.getByText('Project bersama · 150 / 200 tersisa')).toBeInTheDocument();
  expect(document.querySelector('.provider-usage-row time')).not.toBeInTheDocument();
});
it('draws compact bars as the used share, red by default and stronger near the limit', () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  render(<ProviderUsageDetails compact data={{ ...data, windows: [{ ...data.windows[0], usedPercent: 4 }, { ...data.windows[1], usedPercent: 95 }] }} loading={false} error="" />);
  const bars = document.querySelectorAll<HTMLElement>('.provider-usage-bar');
  expect(bars[0].className).toBe('provider-usage-bar');
  expect((bars[0].firstElementChild as HTMLElement).style.width).toBe('4%');
  expect(bars[1]).toHaveClass('is-critical');
  expect((bars[1].firstElementChild as HTMLElement).style.width).toBe('95%');
});
it('explains account access failures without fabricated percentages', () => {
  render(<ProviderUsageDetails data={{ ...data, status: 'unavailable', source: 'none', windows: [], message: 'Akses usage ditolak (HTTP 401).' }} loading={false} error="" />);
  expect(screen.getByText('Akses usage ditolak (HTTP 401).')).toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(screen.getByText(/Terakhir diperiksa/).querySelector('time')).toHaveAttribute('datetime', new Date(now).toISOString());
});
