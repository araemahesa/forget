import { imageVersions, resetImageMocks } from './imageTestSupport';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IconSpec } from '@forgekit/contracts';
import { useImageDocument } from './useImageDocument';
import { exportImageArtifact, loadImageVersion, saveImageVersion } from '../services/images';
import { svgToPng } from '../engines/gfx/png';
import { flushPendingDraft } from './gfx/useGfxDraft';

vi.mock('../engines/gfx/png', () => ({ svgToPng: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])) }));

const spec: IconSpec = {
  schemaVersion: 1, name: 'Fixture', glyph: 'sword', shape: 'circle', style: 'duotone',
  background: 'transparent', primaryColor: '#FF405F', secondaryColor: '#FFD166', strokeWidth: 2, padding: 6, size: 64,
};
beforeEach(resetImageMocks);

it('clears stale SVG and exports the latest spec through native storage after remount', async () => {
  const first = renderHook(() => useImageDocument('icon', spec, 'icon-controls'));
  await act(async () => { await first.result.current.render(); });
  expect(first.result.current.output.icon).toContain('Fixture');
  act(() => first.result.current.change({ name: 'Changed', size: 128 }));
  expect(first.result.current.output).toEqual({});
  await act(async () => { await first.result.current.exportArtifact('icon', 'png'); });
  expect(saveImageVersion).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({ name: 'Changed', size: 128 }) }), expect.any(Array));
  expect(svgToPng).toHaveBeenCalledWith(expect.stringContaining('width="128"'), 128, 128);
  expect(exportImageArtifact).toHaveBeenCalledWith('icon-1', 'icon', 'png');
  first.unmount();
  const next = renderHook(() => useImageDocument('icon', spec, 'icon-controls'));
  await waitFor(() => expect(next.result.current.versions).toHaveLength(1));
  await act(async () => next.result.current.openVersion('icon-1'));
  await waitFor(() => expect(next.result.current.status).toBe('Versi 1 dibuka.'));
  expect(next.result.current.spec.name).toBe('Changed');
  expect(next.result.current.output.icon).toContain('Changed');
});

it('preserves dirty draft and reports errors on native save/load and engine mismatch', async () => {
  const { result } = renderHook(() => useImageDocument('icon', spec, 'icon-controls'));
  await act(async () => { await result.current.save(); });
  vi.mocked(saveImageVersion).mockRejectedValueOnce(new Error('Disk penuh'));
  act(() => result.current.change({ name: 'Unsaved' }));
  await act(async () => { await result.current.save(); });
  expect(result.current.status).toBe('Disk penuh');
  expect(result.current.dirty).toBe(true);
  expect(imageVersions).toHaveLength(1);
  vi.mocked(loadImageVersion).mockRejectedValueOnce(new Error('Integritas gagal'));
  await act(async () => result.current.openVersion('icon-1', true));
  await waitFor(() => expect(result.current.status).toBe('Integritas gagal'));
  expect(result.current.spec.name).toBe('Unsaved');
  vi.mocked(loadImageVersion).mockResolvedValueOnce({ version: imageVersions[0], svgs: { icon: '<svg/>' } });
  await act(async () => result.current.openVersion('icon-1', true));
  await waitFor(() => expect(result.current.status).toContain('berbeda dengan engine'));
  expect(result.current.spec.name).toBe('Unsaved');
});

it('serializes double submissions and blocks exit/backup during rasterization', async () => {
  let finish!: (bytes: Uint8Array) => void;
  vi.mocked(svgToPng).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useImageDocument('icon', spec, 'icon-controls'));
  let saving!: Promise<void>;
  act(() => { saving = result.current.save(); void result.current.save(); result.current.change({ size: 256 }); });
  expect(result.current.busy).toBe(true);
  expect(result.current.spec.size).toBe(64);
  await act(async () => { await expect(flushPendingDraft()).rejects.toThrow('Operasi gambar masih berjalan'); });
  await act(async () => { finish(new Uint8Array([137, 80, 78, 71])); await saving; });
  expect(saveImageVersion).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(false);
  await expect(flushPendingDraft()).resolves.toBeUndefined();
});
