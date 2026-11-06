import { useEffect, useState } from 'react';
import { call } from '../../services/tauri';

type VaultStatus = { connected: boolean; message: string; skillCount?: number; learnedSkillCount?: number; observationCount?: number; learningEnabled?: boolean; learningError?: string };
/** The vault works in the background; only a real problem is shown, never a status line. */
export function ObsidianContext() {
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const status = await call<VaultStatus>('obsidian_status', {});
        if (alive) { setError(status.connected ? status.learningError ? `Pembelajaran Obsidian tertunda: ${status.learningError}` : '' : status.message); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Panduan Obsidian belum dapat dibaca.');
      } finally { pending = false; }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('forgekit:tasks-changed', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); window.removeEventListener('forgekit:tasks-changed', refresh); };
  }, []);
  return error ? <p className="status-error" role="alert">{error}</p> : null;
}
