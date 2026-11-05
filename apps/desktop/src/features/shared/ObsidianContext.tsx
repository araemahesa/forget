import { useEffect, useState } from 'react';
import { call } from '../../services/tauri';
import './obsidian-context.css';

type VaultStatus = { connected: boolean; message: string; skillCount?: number; learnedSkillCount?: number; observationCount?: number; learningEnabled?: boolean; learningError?: string };
export function ObsidianContext() {
  const [error, setError] = useState('');
  const [status, setStatus] = useState<VaultStatus | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const status = await call<VaultStatus>('obsidian_status', {});
        if (alive) { setStatus(status); setError(status.connected ? status.learningError ? `Pembelajaran Obsidian tertunda: ${status.learningError}` : '' : status.message); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Panduan Obsidian belum dapat dibaca.');
      } finally { pending = false; }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('forgekit:tasks-changed', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); window.removeEventListener('forgekit:tasks-changed', refresh); };
  }, []);
  return <>{status?.connected && <p className="obsidian-context" role="status">Obsidian terhubung · {status.skillCount ?? 0} skill · {status.learnedSkillCount ?? 0} panduan pembelajaran{status.learningEnabled ? ' · Belajar otomatis aktif' : ''}</p>}{error && <p className="status-error" role="alert">{error}</p>}</>;
}
