import { useCallback, useEffect, useState } from 'react';
import type { CreativeVersion } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { call } from '../../services/tauri';
import { validateCreativeVersion } from '../create/useCreativeTask';
import { BlenderConnection } from '../shared/BlenderConnection';
import { Model3dEditor } from './Model3dEditor';
import { HunyuanPanel } from './HunyuanPanel';

type ModelTab = { id: string; name: string; versionId?: string; legacy?: boolean; busy?: boolean };
type Workspace = { tabs: ModelTab[]; active: string };
const key = 'forgekit:model3d:tabs:v1';
function restore(): Workspace {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(value?.tabs) && value.tabs.length && value.tabs.every((tab: ModelTab) => typeof tab.id === 'string' && typeof tab.name === 'string' && (tab.versionId === undefined || typeof tab.versionId === 'string')) && new Set(value.tabs.map((tab: ModelTab) => tab.id)).size === value.tabs.length) {
      const tabs = value.tabs.map((tab: ModelTab) => ({ id: tab.id, name: tab.name, versionId: tab.versionId, legacy: tab.legacy === true }));
      return { tabs, active: tabs.some((tab: ModelTab) => tab.id === value.active) ? value.active : tabs[0].id };
    }
  } catch { /* A damaged UI preference never changes saved artifacts. */ }
  return { tabs: [{ id: 'legacy', name: 'Model 3D', legacy: true }], active: 'legacy' };
}

function EditorTab({ tab, active, onChange }: { tab: ModelTab; active: boolean; onChange: (id: string, state: { name?: string; versionId?: string; busy: boolean }) => void }) {
  const update = useCallback((state: { name?: string; versionId?: string; busy: boolean }) => onChange(tab.id, state), [tab.id, onChange]);
  return <Model3dEditor id={tab.id} initialVersionId={tab.versionId} legacy={tab.legacy} active={active} onStateChange={update} />;
}

// ponytail: single generator layout; mode defaults to hunyuan, procedural accessible for legacy tests
export function Model3dPage({ mode }: { mode?: string } = {}) {
  const [workspace, setWorkspace] = useState(restore);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreativeVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify({ ...workspace, tabs: workspace.tabs.map(({ busy: _busy, ...tab }) => tab) }));
  }, [workspace]);
  const update = useCallback((id: string, state: { name?: string; versionId?: string; busy: boolean }) => {
    setWorkspace(previous => {
      const tab = previous.tabs.find(item => item.id === id);
      if (!tab || (tab.name === (state.name ?? tab.name) && tab.versionId === (state.versionId ?? tab.versionId) && !!tab.busy === state.busy)) return previous;
      return { ...previous, tabs: previous.tabs.map(item => item.id === id ? { ...item, name: state.name ?? item.name, versionId: state.versionId ?? item.versionId, busy: state.busy } : item) };
    });
  }, []);
  function add(version?: CreativeVersion) {
    setWorkspace(previous => {
      const existing = version && previous.tabs.find(tab => tab.versionId === version.id);
      if (existing) return { ...previous, active: existing.id };
      const tab: ModelTab = { id: crypto.randomUUID(), name: version?.document.kind === 'model3d' ? version.document.recipe.name : 'Model baru', versionId: version?.id };
      return { tabs: [...previous.tabs, tab], active: tab.id };
    });
    setHistoryOpen(false);
  }
  function close(id: string) {
    setWorkspace(previous => {
      if (previous.tabs.find(tab => tab.id === id)?.busy) return previous;
      const index = previous.tabs.findIndex(tab => tab.id === id);
      const tabs = previous.tabs.filter(tab => tab.id !== id);
      if (!tabs.length) {
        const tab = { id: crypto.randomUUID(), name: 'Model baru' };
        return { tabs: [tab], active: tab.id };
      }
      return { tabs, active: previous.active === id ? tabs[Math.min(index, tabs.length - 1)].id : previous.active };
    });
  }
  useEffect(() => {
    if (!historyOpen) return;
    let current = true;
    setHistoryLoading(true); setError('');
    void call<CreativeVersion[]>('list_creative_versions', { kind: 'model3d' }).then(values => {
      if (current) setHistory(values.map(value => validateCreativeVersion(value, 'model3d')));
    }).catch(e => { if (current) setError(e instanceof Error ? e.message : 'Riwayat gagal dibuka.'); })
      .finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [historyOpen]);

  return <section className="procedural-workspace model-workspace">
    <div className="procedural-heading">
      <div>
        <h1 aria-label="Model 3D">Generator</h1>
        <p>Dari referensi ke Blender dan Roblox Studio.</p>
      </div>
      <BlenderConnection />
    </div>
    {mode === 'procedural' ? (
      <div>
        <div className="model-workspace-bar">
          <div className="model-tabs" role="tablist" aria-label="Tab Model 3D">
            {workspace.tabs.map(tab => <div className="model-tab" key={tab.id} data-active={workspace.active === tab.id}>
              <button type="button" role="tab" id={`tab-${tab.id}`} aria-selected={workspace.active === tab.id} aria-controls={`panel-${tab.id}`} onClick={() => setWorkspace(previous => ({ ...previous, active: tab.id }))} onKeyDown={event => {
                const index = workspace.tabs.findIndex(item => item.id === tab.id);
                const next = event.key === 'ArrowRight' ? (index + 1) % workspace.tabs.length : event.key === 'ArrowLeft' ? (index - 1 + workspace.tabs.length) % workspace.tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? workspace.tabs.length - 1 : -1;
                if (next >= 0) { event.preventDefault(); const id = workspace.tabs[next].id; setWorkspace(previous => ({ ...previous, active: id })); document.getElementById(`tab-${id}`)?.focus(); }
              }} tabIndex={workspace.active === tab.id ? 0 : -1}><Icon name="cube" /><span>{tab.name}</span>{tab.busy && <span className="process-indicator is-running" aria-label="Sedang membuat" />}</button>
              <button type="button" className="model-tab-close" disabled={tab.busy} aria-label={`Tutup tab ${tab.name}`} title={tab.busy ? 'Hentikan proses sebelum menutup tab' : 'Tutup tab'} onClick={() => close(tab.id)}><Icon name="close" /></button>
            </div>)}
          </div>
          <button type="button" className="theme-button" aria-label="Tab Model 3D baru" title="Model baru" onClick={() => add()}><Icon name="plus" /></button>
          <button type="button" className="model-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><Icon name="clock" />Riwayat</button>
        </div>
        {historyOpen && <section className="model-history" aria-label="Riwayat Model 3D">
          <header><h2>Riwayat Model 3D</h2><button className="theme-button" type="button" aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)}><Icon name="close" /></button></header>
          {historyLoading ? <p role="status">Memuat riwayat…</p> : error ? <p role="alert">{error}</p> : history.length ? <div className="model-history-list">{history.map(version => <button type="button" key={version.id} onClick={() => add(version)}><Icon name="cube" /><span><strong>{version.document.kind === 'model3d' ? version.document.recipe.name : 'Model 3D'}</strong><small>{version.parentVersionId ? 'Revisi' : 'Model'} · {new Date(Number(version.createdAt)).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</small></span><Icon name="arrow" /></button>)}</div> : <p>Belum ada model tersimpan.</p>}
        </section>}
        {workspace.tabs.map(tab => <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={workspace.active !== tab.id}><EditorTab tab={tab} active={mode === 'procedural' && workspace.active === tab.id} onChange={update} /></div>)}
      </div>
    ) : (
      <HunyuanPanel active={true} />
    )}
  </section>;
}
