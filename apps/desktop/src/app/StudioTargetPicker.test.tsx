import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StudioTargetPicker } from './StudioTargetPicker';
import { readStudio, captureStudioContext, probeStudio, type StudioReport } from '../services/tauri';
import { refreshStudioContext, selectStudioTarget, setStudioSnapshot, startStudioDiscovery, useStudioDiscovery, useStudioSnapshot } from '../services/studioState';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../services/tauri', () => ({ readStudio: vi.fn(async () => ({ content: [{text: 'Current Studio Mode: Edit'}] })), probeStudio: vi.fn(), captureStudioContext: vi.fn() }));
const report: StudioReport = { executable: 'StudioMCP', checkedAt: String(Date.now()), protocolVersion: '2025-06-18', serverName: 'Studio', studios: [{ studioId: 'one', name: 'Map satu', placeId: 123 }], readTools: ['search_game_tree'] };
const context = { id: 'context', studioId: 'one', displayName: 'Map satu', scope: 'game', depth: 3, observedAt: String(Date.now()), loadedNodes: 1, truncated: false, nodes: [], contentHash: 'a'.repeat(64), skillHash: 'b'.repeat(64) };
function Status() {
  const snapshot = useStudioSnapshot(); const discovery = useStudioDiscovery();
  return <><StudioTargetPicker /><strong data-testid="target">{snapshot?.studio.name ?? 'none'}</strong>{discovery.error && <p>{discovery.error}</p>}</>;
}
beforeEach(async () => { vi.resetAllMocks(); vi.mocked(readStudio).mockResolvedValue({content: [{text: 'Current Studio Mode: Edit'}]}); vi.mocked(probeStudio).mockResolvedValue({ ...report, studios: [] }); setStudioSnapshot(null); await refreshStudioContext(); vi.mocked(captureStudioContext).mockResolvedValue(context); vi.mocked(probeStudio).mockResolvedValue(report); vi.mocked(probeStudio).mockClear(); });
it('starts discovery automatically, selects a single map without a picker and captures bounded context', async () => {
  render(<Status />);
  let stop!: () => void;
  await act(async () => { stop = startStudioDiscovery(); await refreshStudioContext(); });
  expect(screen.getByTestId('target')).toHaveTextContent('Map satu');
  expect(screen.queryByLabelText('Map tujuan')).toBeNull();
  expect(captureStudioContext).toHaveBeenCalledWith('one', 'game', 3);
  stop();
});
it('does not guess between multiple maps and discards context when target disappears', async () => {
  vi.mocked(probeStudio).mockResolvedValue({ ...report, studios: [...report.studios, { studioId: 'two', name: 'Map dua', placeId: 456 }] });
  render(<Status />);
  await act(async () => { await refreshStudioContext(); });
  expect(screen.getByLabelText('Map tujuan')).toBeVisible();
  expect(screen.getByTestId('target')).toHaveTextContent('none');
  expect(captureStudioContext).not.toHaveBeenCalled();
  await act(async () => { selectStudioTarget('one'); await refreshStudioContext(); });
  expect(screen.getByTestId('target')).toHaveTextContent('Map satu');
  vi.mocked(probeStudio).mockResolvedValue({ ...report, studios: [] });
  await act(async () => { await refreshStudioContext(); });
  expect(screen.getByTestId('target')).toHaveTextContent('none');
  expect(screen.queryByLabelText('Map tujuan')).toBeNull();
});
it('coalesces overlapping checks and clears stale context after a transport error', async () => {
  let resolve!: (value: StudioReport) => void;
  vi.mocked(probeStudio).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<Status />);
  const first = refreshStudioContext(); const second = refreshStudioContext();
  expect(first).toBe(second); expect(probeStudio).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(report); await first; });
  vi.mocked(probeStudio).mockRejectedValue(new Error('Transport terputus'));
  await act(async () => { await refreshStudioContext(); });
  expect(screen.getByTestId('target')).toHaveTextContent('none');
  expect(screen.getByText('Transport terputus')).toBeInTheDocument();
});
