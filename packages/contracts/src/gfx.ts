export type ValidationIssue = { path: string; severity: 'error' | 'warning' | 'info'; message: string };
export type GfxSpec = { schemaVersion: 1; title: string; subtitle: string; width: number; height: number; layout: 'centered' | 'split' | 'stacked'; background: string; accent: string };
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'cancel_requested' | 'interrupted';
export type GfxVersion = { id: string; itemId: string; sequence: number; spec: GfxSpec; checks: ValidationIssue[]; createdAt: string; artifact: { svgRelativePath: string; pngRelativePath: string; sha256: string; byteLength: number; pngSha256: string; pngByteLength: number } | null };
export { validateGfxSpec, hasBlockingGfxErrors } from './visual-runtime.js';
