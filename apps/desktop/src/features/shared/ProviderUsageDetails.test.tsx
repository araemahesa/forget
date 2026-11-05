import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderUsageDetails } from './ProviderUsageDetails';
import type { ProviderUsage } from '../../services/providerUsage';
const now = new Date('2026-10-28T04:00:00Z').getTime();
const data: ProviderUsage = { profileId: 'a', status: 'available', source: 'provider_api', checkedAt: now / 1000, observedAt: now / 1000, planType: 'plus', message: null,
  windows: [{ id: '5h', label: '5h', scope: 'ChatGPT', usedPercent: 85, windowDurationMins: 300, resetsAt: now / 1000 + 3600, remaining: null, limit: null, unit: null },
    { id: 'week', label: 'Mingguan', scope: 'ChatGPT', usedPercent: 40, windowDurationMins: 10080, resetsAt: now / 1000 + 432000, remaining: null, limit: null, unit: null }] };
afterEach(() => vi.useRealTimers());
it('shows compact remaining percentages and real reset dates like the reference', () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  render(<ProviderUsageDetails data={data} loading={false} error="" />);
  expect(screen.getByText('Sisa penggunaan')).toBeInTheDocument();
  expect(screen.getByLabelText('15% tersisa')).toHaveTextContent('15%');
  expect(screen.getByLabelText('60% tersisa')).toHaveTextContent('60%');
  expect(document.querySelectorAll('.provider-usage-row time')).toHaveLength(2);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not show expired observations as current capacity', () => {
  vi.useFakeTimers(); vi.setSystemTime(now + 7200000);
  render(<ProviderUsageDetails data={data} loading={false} error="" />);
  expect(screen.queryByLabelText('15% tersisa')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Menunggu data terbaru')).toHaveTextContent('—');
  expect(screen.getByLabelText('60% tersisa')).toHaveTextContent('60%');
});
it('uses the same rows for API/project quotas and does not invent their reset time', () => {
  render(<ProviderUsageDetails data={{ ...data, source: 'google_monitoring', windows: [{ ...data.windows[0], label: 'Permintaan API', scope: 'Project bersama', usedPercent: 25, resetsAt: null, remaining: 150, limit: 200 }] }} loading={false} error="" />);
  expect(screen.getByLabelText('75% tersisa')).toBeInTheDocument();
  expect(screen.getByText('Project bersama · 150 / 200 tersisa')).toBeInTheDocument();
  expect(document.querySelector('.provider-usage-row time')).not.toBeInTheDocument();
});
it('explains account access failures without fabricated percentages', () => {
  render(<ProviderUsageDetails data={{ ...data, status: 'unavailable', source: 'none', windows: [], message: 'Akses usage ditolak (HTTP 401).' }} loading={false} error="" />);
  expect(screen.getByText('Akses usage ditolak (HTTP 401).')).toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(screen.getByText(/Terakhir diperiksa/).querySelector('time')).toHaveAttribute('datetime', new Date(now).toISOString());
});
