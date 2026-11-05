export type StudioTargetStamp = { studioId: string; name: string; placeId?: string | number | null; mode: string; epoch: number };
export type ContextNode = { name: string; className: string; children: ContextNode[] };
export type ContextSnapshot = { id: string; studioId: string; displayName: string; scope: string; depth: number; observedAt: string; loadedNodes: number; truncated: boolean; nodes: ContextNode[]; contentHash: string; skillHash: string; target?: StudioTargetStamp | null };
export { validateContextSnapshot } from './snapshot-runtime.js';
