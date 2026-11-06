import { afterEach, expect, it, vi } from 'vitest';
import { safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from './safeStorage';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('reads, writes and removes values normally', () => {
  expect(safeSetItem('forgekit:test', 'a')).toBe(true);
  expect(safeGetItem('forgekit:test')).toBe('a');
  expect(safeKeys('forgekit:')).toEqual(['forgekit:test']);
  safeRemoveItem('forgekit:test');
  expect(safeGetItem('forgekit:test')).toBeNull();
});

it('swallows quota and access errors instead of throwing', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Penuh', 'QuotaExceededError'); });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Diblokir'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Diblokir'); });
  expect(safeSetItem('forgekit:test', 'a')).toBe(false);
  expect(safeGetItem('forgekit:test')).toBeNull();
  expect(() => safeRemoveItem('forgekit:test')).not.toThrow();
});
