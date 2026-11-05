import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useState } from 'react';
import type { McpConnectorConfig, McpToolInfo } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { listAvailableMcpTools, listMcpConnectors, saveMcpConnector } from '../../services/ai';

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<McpConnectorConfig[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [serverName, setServerName] = useState('Roblox Studio Local Bridge');
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listMcpConnectors().then(setConnectors).catch(() => {});
    listAvailableMcpTools().then(setTools).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: McpConnectorConfig = {
        id: `mcp-${Date.now()}`,
        name: serverName,
        transport,
        isEnabled: true,
        allowedTools: ['read_studio', 'write_studio'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveMcpConnector(config);
      const updated = await listMcpConnectors();
      setConnectors(updated);
    } catch {
      // offline / mock
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="link" />
          <h2>Konektor & MCP Sharing</h2>
        </div>
        <p className="section-desc">Konfigurasi Model Context Protocol (MCP) untuk menghubungkan agen AI ke Roblox Studio.</p>

        <div className="form-group">
          <label htmlFor="mcp-name">Nama Konektor MCP</label>
          <input
            id="mcp-name"
            className="text-input"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="mcp-transport">Transport Protocol</label>
          <Dropdown
            id="mcp-transport"
            className="select-input"
            value={transport}
            onChange={(e) => setTransport(e.target.value as 'stdio' | 'sse')}
          >
            <option value="stdio">Standard I/O Subprocess (stdio)</option>
            <option value="sse">Server-Sent Events HTTP (SSE)</option>
          </Dropdown>
        </div>

        <button
          className="button primary-button btn-full"
          disabled={saving || !serverName.trim()}
          onClick={handleSave}
          type="button"
        >
          <Icon name="check" />
          <span>{saving ? 'Menyimpan Konektor...' : 'Tambah Konektor MCP'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Tools MCP Tersedia ({tools.length})</span>
            <span className="small-tag">Studio Protocol</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nama Tool</th>
                  <th>Kategori Scope</th>
                  <th>Deskripsi</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
                  <tr key={tool.name}>
                    <td><code>{tool.name}</code></td>
                    <td>{tool.isWrite ? 'Mutasi Studio (Write)' : 'Inspeksi State (Read)'}</td>
                    <td><span className="text-muted">{tool.description}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="preview-card" style={{ marginTop: '20px' }}>
          <div className="preview-header">
            <span className="preview-title">Konektor Terkonfigurasi ({connectors.length})</span>
          </div>
          <div className="node-list">
            {connectors.map((c) => (
              <div key={c.id} className="node-list-item" style={{ cursor: 'default' }}>
                <Icon name="link" />
                <span><strong>{c.name}</strong> ({c.transport}) — {c.allowedTools.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
