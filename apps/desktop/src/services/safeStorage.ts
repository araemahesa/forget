// localStorage can throw (quota full, storage disabled); UI preferences must never crash the app.
export function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function safeSetItem(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function safeRemoveItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Nothing to clean up when storage is unavailable. */ }
}
/** Keys in storage starting with `prefix`; empty when storage is unavailable. */
export function safeKeys(prefix: string): string[] {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key?.startsWith(prefix)) keys.push(key); }
    return keys;
  } catch { return []; }
}
