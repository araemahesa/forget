import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GfxSpec } from '@forgekit/contracts';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { createGfxTask, exportGfxArtifact, listGfxVersions, loadGfxVersion, saveGfxVersion } from './tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const validSpec: GfxSpec = {
  schemaVersion: 1,
  title: 'ForgeKit',
  subtitle: 'Create clearly',
  background: '#101216',
  accent: '#94ACFF',
  layout: 'centered',
  width: 1200,
  height: 800,
};

beforeEach(() => { vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(true); });

describe('typed native GFX service', () => {
  it('explains desktop requirement without attempting browser IPC', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(listGfxVersions()).rejects.toMatchObject({
      code: 'IPC_ERROR', message: 'Penyimpanan lokal memerlukan aplikasi desktop ForgeKit Studio.',
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('lists versions and exports only a saved version and format', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]).mockResolvedValueOnce({ relativePath: 'exports/gfx-1.svg', sha256: 'hash', byteLength: 42 });
    expect(await listGfxVersions()).toEqual([]);
    expect(await exportGfxArtifact('gfx-1', 'svg')).toMatchObject({ relativePath: 'exports/gfx-1.svg' });
    expect(invoke).toHaveBeenLastCalledWith('export_gfx_artifact', { id: 'gfx-1', kind: 'svg' });
  });
  it('maps native save response into a version', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 'gfx-1',
      itemId: 'item-1',
      sequence: 1,
      spec: validSpec,
      checks: [],
      createdAt: '2026-10-25T00:00:00Z',
    });

    const version = await saveGfxVersion('task-1', '<svg/>', new Uint8Array([137, 80]));

    expect(invoke).toHaveBeenCalledWith('save_gfx_version', { taskId: 'task-1', svg: '<svg/>', png: [137, 80] });
    expect(version.sequence).toBe(1);
    expect(version.spec).toEqual(validSpec);
  });

  it('returns typed error for invalid native input', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({
      code: 'VALIDATION_ERROR',
      message: 'width and height must be 128..4096',
      issues: [{ path: 'width', severity: 'error', message: 'invalid' }],
    });

    await expect(createGfxTask({ ...validSpec, width: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('loads a saved version by ID', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 'gfx-1',
      itemId: 'item-1',
      sequence: 1,
      spec: validSpec,
      checks: [],
      createdAt: '2026-10-25T00:00:00Z',
    });

    await loadGfxVersion('gfx-1');
    expect(invoke).toHaveBeenCalledWith('load_gfx_version', { id: 'gfx-1' });
  });
});
