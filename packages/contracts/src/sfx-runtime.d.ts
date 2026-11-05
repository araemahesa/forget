import type { ValidationIssue } from './gfx';
export function validateSfxRecipe(input: unknown): ValidationIssue[];
export function hasBlockingSfxErrors(issues: readonly ValidationIssue[]): boolean;
