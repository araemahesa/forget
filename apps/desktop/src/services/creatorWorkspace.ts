import { call } from './tauri';
import type { ImageKind } from './images';

export type CreatorKind = ImageKind | 'sfx';
export type LibraryKind = CreatorKind | 'gfx';
export const creatorLabels: Record<LibraryKind, string> = { gfx: 'GFX', icon: 'Ikon', texture: 'Tekstur', clothing: 'Pakaian', sfx: 'Efek suara' };
export const creatorRoutes: Record<LibraryKind, string> = { gfx: 'gfx', icon: 'icons', texture: 'texture', clothing: 'clothing', sfx: 'sfx' };
export type CreatorDraft<T = unknown> = {
  kind: CreatorKind; spec: T; baselineVersionId: string | null; engineVersion: number; revision: number; updatedAt: string;
};
export const loadCreatorDraft = <T>(kind: CreatorKind) => call<CreatorDraft<T> | null>('load_creator_draft', { kind });
export const saveCreatorDraft = <T>(draft: CreatorDraft<T>) => call<CreatorDraft<T>>('save_creator_draft', { draft });

export type WorkStatus = 'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'failed' | 'succeeded' | 'interrupted';
export type WorkTask = {
  id: string; kind: CreatorKind; action: 'render' | 'save' | 'export' | 'open'; input: { name?: string };
  engineVersion: number; status: WorkStatus; stage: string; receipt: Record<string, unknown> | null;
  error: string | null; createdAt: string; updatedAt: string;
  events: { sequence: number; status: WorkStatus; stage: string; receipt: Record<string, unknown> | null; createdAt: string }[];
};
export const listWorkTasks = () => call<WorkTask[]>('list_work_tasks', {});
export const createWorkTask = (kind: CreatorKind, action: WorkTask['action'], input: unknown) => call<WorkTask>('create_work_task', { kind, action, input });
export const updateWorkTask = (id: string, status: WorkStatus, stage: string, receipt: Record<string, unknown> | null = null, error: string | null = null) =>
  call<WorkTask>('update_work_task', { id, status, stage, receipt, error });

export type LibraryEntry = { id: string; kind: LibraryKind; name: string; sequence: number; createdAt: string; deletedAt: string | null };
export const listLibrary = (query: string, kind: LibraryKind | 'all', deleted: boolean, offset = 0) =>
  call<LibraryEntry[]>('list_library', { query, kind, deleted, offset });
export const setLibraryDeleted = (kind: LibraryKind, id: string, deleted: boolean) =>
  call<void>('set_library_deleted', { kind, id, deleted });
