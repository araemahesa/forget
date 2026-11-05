import { invoke, isTauri } from '@tauri-apps/api/core';
import type { GfxSpec, GfxVersion, ValidationIssue } from '@forgekit/contracts';
import { validateContextSnapshot, type ContextSnapshot } from '@forgekit/contracts';

export type NativeErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'STORAGE_ERROR' | 'CANCELLED' | 'IPC_ERROR' | 'CONFLICT' | 'STUDIO_ERROR';

export class NativeCommandError extends Error {
  readonly code: NativeErrorCode;
  readonly issues: ValidationIssue[];

  constructor(code: NativeErrorCode, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = 'NativeCommandError';
    this.code = code;
    this.issues = issues;
  }
}

type NativeErrorPayload = {
  code?: NativeErrorCode;
  message?: string;
  issues?: ValidationIssue[];
};

function mapNativeError(error: unknown): NativeCommandError {
  if (error instanceof NativeCommandError) return error;
  const payload = typeof error === 'object' && error !== null ? error as NativeErrorPayload : {};
  return new NativeCommandError(
    payload.code ?? 'IPC_ERROR',
    payload.message ?? 'Perintah native gagal.',
    payload.issues ?? [],
  );
}

export async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new NativeCommandError('IPC_ERROR', 'Penyimpanan lokal memerlukan aplikasi desktop ForgeKit Studio.');
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw mapNativeError(error);
  }
}

export type GfxTask = {
  id: string;
  inputVersionId: string;
  outputVersionId: string | null;
  status: import('@forgekit/contracts').TaskStatus;
  error: string | null;
};

export type GfxTaskSummary = GfxTask & { title: string; updatedAt: string };

export function listGfxTasks(): Promise<GfxTaskSummary[]> {
  return call<GfxTaskSummary[]>('list_gfx_tasks', {});
}

export type WorkspaceInfo = { rootPath: string; orphanArtifacts: string[] };
export type ArtifactExport = { relativePath: string; sha256: string; byteLength: number };

export function createGfxTask(spec: GfxSpec): Promise<GfxTask> {
  return call<GfxTask>('create_gfx_task', { spec });
}

export function saveGfxVersion(taskId: string, svg: string, png: Uint8Array): Promise<GfxVersion> {
  return call<GfxVersion>('save_gfx_version', { taskId, svg, png: Array.from(png) });
}

export function cancelGfxTask(taskId: string): Promise<GfxTask> {
  return call<GfxTask>('cancel_gfx_task', { taskId });
}

export function listGfxVersions(): Promise<GfxVersion[]> {
  return call<GfxVersion[]>('list_gfx_versions', {});
}

export function exportGfxArtifact(id: string, kind: 'svg' | 'png'): Promise<ArtifactExport> {
  return call<ArtifactExport>('export_gfx_artifact', { id, kind });
}

export function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  return call<WorkspaceInfo>('get_workspace_info', {});
}

export function loadGfxVersion(id: string): Promise<GfxVersion> {
  if (!id.trim()) {
    return Promise.reject(new NativeCommandError('VALIDATION_ERROR', 'ID versi wajib diisi.'));
  }
  return call<GfxVersion>('load_gfx_version', { id });
}

export type GfxDraft = { spec: GfxSpec; baselineVersionId: string | null; revision: number; updatedAt: string };
export function loadGfxDraft(): Promise<GfxDraft | null> {
  return call<GfxDraft | null>('load_gfx_draft', {});
}
export function saveGfxDraft(spec: GfxSpec, baselineVersionId: string | null, expectedRevision: number): Promise<GfxDraft> {
  return call<GfxDraft>('save_gfx_draft', { spec, baselineVersionId, expectedRevision });
}
export type BackupInfo = { id: string; directory: string; createdAt: string; artifactCount: number; byteLength: number };
export function createWorkspaceBackup(): Promise<BackupInfo> {
  return call<BackupInfo>('create_workspace_backup', {});
}
export function listWorkspaceBackups(): Promise<BackupInfo[]> {
  return call<BackupInfo[]>('list_workspace_backups', {});
}
export function verifyWorkspaceBackup(id: string): Promise<BackupInfo> {
  return call<BackupInfo>('verify_workspace_backup', { id });
}
export function restoreWorkspaceBackup(id: string): Promise<string> {
  return call<string>('restore_workspace_backup', { id });
}
export function finishAppExit(): Promise<void> {
  return call<void>('finish_app_exit', {});
}

export type StudioReport = {
  executable: string;
  protocolVersion: string;
  serverName: string;
  checkedAt: string;
  availability?: 'not_running' | 'not_installed' | 'mcp_ready';
  studios: { studioId: string; name: string; placeId: string | number | null; target?: import('@forgekit/contracts').StudioTargetStamp | null; verificationError?: string | null }[];
  readTools: string[];
};
export function probeStudio(): Promise<StudioReport> {
  if (!isTauri()) return Promise.reject(new NativeCommandError('IPC_ERROR', 'Pemeriksaan Studio memerlukan aplikasi desktop ForgeKit Studio.'));
  return call<StudioReport>('probe_studio', {});
}
export function readStudio(studioId: string, tool: string, path?: string, depth?: number): Promise<unknown> {
  return call<unknown>('read_studio', { studioId, tool, path, depth });
}

export type StudioInstanceData = {
  name: string;
  className: string;
  fullPath: string;
  parentName?: string;
  childSummary?: string;
  unexploredChildCount?: number;
};

export type StudioInspectionData = {
  name: string;
  className: string;
  path: string;
  uniqueId?: string;
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  children?: {
    immediateChildren?: Array<{ className: string; path: string }>;
    childrenCount?: number;
    totalDescendants?: number;
  };
  matches?: Array<{
    name: string;
    className: string;
    path: string;
    uniqueId?: string;
    properties?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  }>;
  count?: number;
  totalFound?: number;
  warning?: string;
};

export async function fetchStudioSubtree(studioId: string, path?: string, depth = 2): Promise<StudioInstanceData[]> {
  const result = await readStudio(studioId, 'search_game_tree', path, depth);
  if (Array.isArray(result)) return result as StudioInstanceData[];
  if (result && typeof result === 'object' && 'results' in result && Array.isArray((result as { results: unknown }).results)) {
    return (result as { results: StudioInstanceData[] }).results;
  }
  return [];
}

export async function inspectStudioInstance(studioId: string, path: string): Promise<StudioInspectionData | null> {
  const result = await readStudio(studioId, 'inspect_instance', path, 1);
  if (result && typeof result === 'object') return result as StudioInspectionData;
  return null;
}

export async function readStudioScript(studioId: string, targetFile: string): Promise<string> {
  const result = await readStudio(studioId, 'script_read', targetFile, 1);
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if ('text' in result && typeof (result as { text: string }).text === 'string') return (result as { text: string }).text;
    if ('content' in result && Array.isArray((result as { content: Array<{ text?: string }> }).content)) {
      return (result as { content: Array<{ text?: string }> }).content.map((c) => c.text ?? '').join('\n');
    }
  }
  return '';
}

export async function captureStudioContext(studioId: string, path: string, depth: number): Promise<ContextSnapshot> {
  const snapshot = await call<unknown>('capture_studio_context', { studioId, path, depth });
  if (!validateContextSnapshot(snapshot)) throw new NativeCommandError('VALIDATION_ERROR', 'Format snapshot Studio tidak sah.');
  return snapshot;
}
