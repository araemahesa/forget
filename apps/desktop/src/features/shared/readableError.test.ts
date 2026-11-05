import { expect, it } from 'vitest';
import { readableError } from './readableError';
it('retains recovery instructions without exposing internal classification tags', () => {
  expect(readableError('[NEEDS_EDIT][TOOL_NOT_DISPATCHED] Menunggu mode Edit.')).toBe('Menunggu mode Edit.');
  expect(readableError('[KEYCHAIN_LOCKED] Pilih Uji koneksi.')).toBe('Pilih Uji koneksi.');
  expect(readableError('Objek [Folder] tidak ditemukan.')).toBe('Objek [Folder] tidak ditemukan.');
});
