import type { SfxRecipe } from '@forgekit/contracts';
import { call, type ArtifactExport } from './tauri';

export type SavedSfxVersion = {
  id: string;
  sequence: number;
  recipe: SfxRecipe;
  sha256: string;
  byteLength: number;
  createdAt: string;
};

export const listSfxVersions = () => call<SavedSfxVersion[]>('list_sfx_versions', {});
export const saveSfxVersion = (recipe: SfxRecipe, wavBytes: Uint8Array, workTaskId?: string) =>
  call<SavedSfxVersion>('save_sfx_version', { recipe, wavBytes: Array.from(wavBytes), workTaskId });
export const loadSfxVersion = (id: string) =>
  call<{ version: SavedSfxVersion; wavBytes: number[] }>('load_sfx_version', { id });
export const exportSfxVersion = (id: string) => call<ArtifactExport>('export_sfx_version', { id });
