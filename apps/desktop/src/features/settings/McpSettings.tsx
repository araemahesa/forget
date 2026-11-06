import { useEffect, useState, type FormEvent } from 'react';
import type { McpConnectorConfig, McpToolInfo } from '@forgekit/contracts';
import { deleteMcpConnector, listAvailableMcpTools, listMcpConnectors, saveMcpConnector, toggleMcpConnector } from '../../services/ai';

type Draft = { name: string; command: string; args: string; allowedTools: string };
const emptyDraft: Draft = { name: '', command: '', args: '', allowedTools: '' };
const failure = (error: unknown) => error instanceof Error ? error.message : 'Operasi konektor gagal.';

function toConfig(draft: Draft): McpConnectorConfig {
  const now = new Date().toISOString();
  return {
    id: `mcp-${crypto.randomUUID()}`,
    name: draft.name.trim(),
    transport: 'stdio',
    command: draft.command.trim(),
    // One argument per line keeps paths with spaces intact.
    args: draft.args.split('\n').map((value) => value.trim()).filter(Boolean),
    isEnabled: true,
    allowedTools: draft.allowedTools.split(',').map((value) => value.trim()).filter(Boolean),
    createdAt: now,
    updatedAt: now,
  };
}

function ToolList({ tools }: { tools: McpToolInfo[] }) {
  if (!tools.length) return <p className="mcp-empty">Server tidak menyediakan tool.</p>;
  return <ul className="mcp-tools" aria-label="Tool tersedia">
    {tools.map((tool) => <li key={`${tool.category}:${tool.name}`}><code>{tool.name}</code><span className={tool.isWrite ? 'mcp-badge is-write' : 'mcp-badge'}>{tool.isWrite ? 'tulis' : 'baca'}</span>{tool.description && <small>{tool.description}</small>}</li>)}
  </ul>;
}

export function McpSettings() {
  const [connectors, setConnectors] = useState<McpConnectorConfig[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [tools, setTools] = useState<Record<string, McpToolInfo[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const refresh = () => listMcpConnectors().then(setConnectors);
  useEffect(() => { void refresh().catch((e: unknown) => setError(failure(e))); }, []);

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(failure(e)); } finally { setBusy(null); }
  }
  const inspect = (config: McpConnectorConfig, key: string) => act(key, async () => {
    const found = await listAvailableMcpTools(config);
    setTools((items) => ({ ...items, [key]: found }));
    setStatus(`${config.name}: ${found.length} tool ditemukan.`);
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const config = toConfig(draft);
    void act('save', async () => {
      await saveMcpConnector(config);
      await refresh();
      setDraft(emptyDraft);
      setTools((items) => { const { draft: _unused, ...rest } = items; return rest; });
      setStatus(`${config.name} tersimpan dan aktif untuk chat berikutnya.`);
    });
  }

  return <section className="settings-section mcp-settings" id="settings-connectors" aria-labelledby="mcp-heading">
    <h2 id="mcp-heading" tabIndex={-1}>Konektor MCP</h2>
    <p>Server MCP dijalankan di komputer ini selama satu permintaan chat, lalu dihentikan. Setiap kali AI memanggil tool MCP, ForgeKit meminta persetujuan Anda dulu. Label baca/tulis berasal dari server dan hanya informasi.</p>
    {error && <p role="alert" className="status-error">{error}</p>}
    {status && <p role="status">{status}</p>}
    <ul className="mcp-list" aria-label="Konektor tersimpan">
      {connectors.map((connector) => <li key={connector.id} className="mcp-connector">
        <div className="setting-row">
          <span><strong>{connector.name}</strong><small><code>{[connector.command, ...connector.args].join(' ') || 'Perintah belum diisi'}</code>{connector.allowedTools.length ? ` · ${connector.allowedTools.length} tool diizinkan` : ' · semua tool'}</small></span>
          <label className="mcp-toggle"><input type="checkbox" aria-label={`Aktifkan ${connector.name}`} checked={connector.isEnabled} disabled={!!busy}
            onChange={(event) => void act(connector.id, async () => { await toggleMcpConnector(connector.id, event.target.checked); await refresh(); })} />Aktif</label>
        </div>
        <div className="mcp-actions">
          <button className="button secondary-button" type="button" disabled={!!busy || !connector.command} onClick={() => void inspect(connector, connector.id)}>{busy === connector.id ? 'Memeriksa...' : 'Periksa tools'}</button>
          <button className="button secondary-button" type="button" disabled={!!busy} onClick={() => {
            if (!window.confirm(`Hapus konektor "${connector.name}"?`)) return;
            void act(connector.id, async () => { await deleteMcpConnector(connector.id); await refresh(); });
          }}>Hapus</button>
        </div>
        {tools[connector.id] && <ToolList tools={tools[connector.id]} />}
      </li>)}
      {!connectors.length && <li className="mcp-empty">Belum ada konektor.</li>}
    </ul>
    <form className="provider-modal-form mcp-form" onSubmit={submit} aria-label="Tambah konektor MCP">
      <label>Nama<input value={draft.name} maxLength={100} required disabled={!!busy} placeholder="Filesystem proyek" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Perintah<input value={draft.command} required disabled={!!busy} placeholder="npx" onChange={(e) => setDraft({ ...draft, command: e.target.value })} /></label>
      <label>Argumen (satu per baris)<textarea rows={3} value={draft.args} disabled={!!busy} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/nama/Proyek'} onChange={(e) => setDraft({ ...draft, args: e.target.value })} /></label>
      <label>Tool yang diizinkan (opsional, pisahkan koma)<input value={draft.allowedTools} disabled={!!busy} placeholder="Kosongkan untuk semua tool" onChange={(e) => setDraft({ ...draft, allowedTools: e.target.value })} /></label>
      <div className="mcp-actions">
        <button className="button secondary-button" type="button" disabled={!!busy || !draft.name.trim() || !draft.command.trim()} onClick={() => void inspect(toConfig(draft), 'draft')}>{busy === 'draft' ? 'Memeriksa...' : 'Uji server'}</button>
        <button className="button primary-button" type="submit" disabled={!!busy}>{busy === 'save' ? 'Menyimpan...' : 'Simpan konektor'}</button>
      </div>
      {tools.draft && <ToolList tools={tools.draft} />}
    </form>
  </section>;
}
