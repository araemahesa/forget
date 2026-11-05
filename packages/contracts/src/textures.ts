import type { ValidationIssue } from './gfx';

export type TexturePattern =
  | 'noise'
  | 'bricks'
  | 'wood'
  | 'metal_grid'
  | 'hex_tiles'
  | 'fabric'
  | 'stone';

export type TextureMapType = 'baseColor' | 'normal' | 'roughness' | 'height';

export type TextureSpec = {
  schemaVersion: 1;
  name: string;
  pattern: TexturePattern;
  baseColor: string;
  accentColor: string;
  roughness: number;
  metalness: number;
  scale: number;
  seed: number;
  resolution: 128 | 256 | 512;
};

export const texturePatterns: readonly TexturePattern[] = [
  'noise',
  'bricks',
  'wood',
  'metal_grid',
  'hex_tiles',
  'fabric',
  'stone',
];

export const textureResolutions: readonly (128 | 256 | 512)[] = [128, 256, 512];

const hexColor = /^#[0-9a-fA-F]{6}$/;
const invalidTextCharacters = /[\u0000-\u001F\u007F\uD800-\uDFFF\uFFFE\uFFFF]/u;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTextureSpec(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = isRecord(input) ? input : {};

  if (value.schemaVersion !== 1) {
    issues.push({ path: 'schemaVersion', severity: 'error', message: 'Harus menggunakan skema versi 1.' });
  }

  if (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 60) {
    issues.push({ path: 'name', severity: 'error', message: 'Nama tekstur harus berisi 1–60 karakter.' });
  } else if (invalidTextCharacters.test(value.name)) {
    issues.push({ path: 'name', severity: 'error', message: 'Nama tidak boleh mengandung karakter kontrol.' });
  }

  if (!texturePatterns.includes(value.pattern as TexturePattern)) {
    issues.push({ path: 'pattern', severity: 'error', message: 'Pola tekstur tidak dikenal.' });
  }

  if (typeof value.baseColor !== 'string' || !hexColor.test(value.baseColor)) {
    issues.push({ path: 'baseColor', severity: 'error', message: 'Warna dasar harus berupa #RRGGBB.' });
  }

  if (typeof value.accentColor !== 'string' || !hexColor.test(value.accentColor)) {
    issues.push({ path: 'accentColor', severity: 'error', message: 'Warna aksen harus berupa #RRGGBB.' });
  }

  if (typeof value.roughness !== 'number' || !Number.isFinite(value.roughness) || value.roughness < 0 || value.roughness > 1) {
    issues.push({ path: 'roughness', severity: 'error', message: 'Roughness harus antara 0.0 dan 1.0.' });
  }

  if (typeof value.metalness !== 'number' || !Number.isFinite(value.metalness) || value.metalness < 0 || value.metalness > 1) {
    issues.push({ path: 'metalness', severity: 'error', message: 'Metalness harus antara 0.0 dan 1.0.' });
  }

  if (typeof value.scale !== 'number' || !Number.isInteger(value.scale) || value.scale < 1 || value.scale > 16) {
    issues.push({ path: 'scale', severity: 'error', message: 'Skala pengulangan harus berupa bilangan bulat antara 1 dan 16.' });
  }

  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 999999) {
    issues.push({ path: 'seed', severity: 'error', message: 'Seed harus berupa bilangan bulat antara 0 dan 999999.' });
  }

  if (!textureResolutions.includes(value.resolution as 128 | 256 | 512)) {
    issues.push({ path: 'resolution', severity: 'error', message: 'Resolusi harus 128, 256, atau 512 px.' });
  }

  return issues;
}

export function hasBlockingTextureErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
