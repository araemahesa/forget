import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { RobloxAssetItem } from '@forgekit/contracts';
import { validateRobloxAssetItem } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialAssets: RobloxAssetItem[] = [
  { id: 'ast-1', assetId: '14285938491', name: 'Texture_AncientStone', assetType: 'Decal', creatorType: 'User', creatorTargetId: '54201984', status: 'ready', sizeBytes: 524288 },
  { id: 'ast-2', assetId: '14285949204', name: 'SFX_SwordImpactMetal', assetType: 'Audio', creatorType: 'User', creatorTargetId: '54201984', status: 'ready', sizeBytes: 124000 },
  { id: 'ast-3', name: 'Armor_KnightHelm_LOD0', assetType: 'MeshPart', creatorType: 'Group', creatorTargetId: '1092485', status: 'moderation_pending', sizeBytes: 1048576 },
];

export function AssetManagerPage() {
  const [assets, setAssets] = useState<RobloxAssetItem[]>(initialAssets);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<RobloxAssetItem['assetType']>('Decal');
  const [creatorId, setCreatorId] = useState('54201984');
  const [uploading, setUploading] = useState(false);

  const errors = validateRobloxAssetItem({
    id: 'temp',
    name: newName,
    assetType: newType,
    creatorType: 'User',
    creatorTargetId: creatorId,
    status: 'draft',
  });

  const handleUpload = () => {
    if (errors.length > 0) return;
    setUploading(true);
    setTimeout(() => {
      const created: RobloxAssetItem = {
        id: `ast-${Date.now()}`,
        assetId: String(Math.floor(10000000000 + Math.random() * 90000000000)),
        name: newName,
        assetType: newType,
        creatorType: 'User',
        creatorTargetId: creatorId,
        status: 'moderation_pending',
        sizeBytes: 256000,
      };
      setAssets([created, ...assets]);
      setNewName('');
      setUploading(false);
    }, 600);
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="cube" />
          <h2>Kelola Aset Roblox</h2>
        </div>
        <p className="section-desc">Unggah dan unduh aset melalui Roblox Open Cloud API dengan status moderasi jujur.</p>

        <div className="form-group">
          <label htmlFor="asset-name">Nama Aset Baru</label>
          <input
            id="asset-name"
            className="text-input"
            placeholder="Contoh: Decal_LogoGame"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="asset-type">Tipe Aset</label>
          <Dropdown
            id="asset-type"
            className="select-input"
            value={newType}
            onChange={(e) => setNewType(e.target.value as RobloxAssetItem['assetType'])}
          >
            <option value="Decal">Decal / Tekstur Gambar</option>
            <option value="Audio">Audio / Efek Suara WAV</option>
            <option value="Model">Model 3D / RBXM</option>
            <option value="MeshPart">MeshPart Geometri</option>
            <option value="Animation">KeyframeSequence Animasi</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <label htmlFor="asset-creator">Target User / Group ID</label>
          <input
            id="asset-creator"
            className="text-input"
            value={creatorId}
            onChange={(e) => setCreatorId(e.target.value)}
          />
        </div>

        <button
          className="button primary-button btn-full"
          disabled={uploading || !newName.trim()}
          onClick={handleUpload}
          type="button"
        >
          <Icon name="upload" />
          <span>{uploading ? 'Mengunggah ke Open Cloud...' : 'Unggah Aset'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Daftar Inventaris Aset ({assets.length})</span>
            <span className="small-tag">Roblox Open Cloud</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nama Aset</th>
                  <th>Tipe</th>
                  <th>Asset ID</th>
                  <th>Status Moderasi</th>
                  <th>Ukuran</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.name}</strong></td>
                    <td><span className="small-tag">{item.assetType}</span></td>
                    <td><code>{item.assetId || '—'}</code></td>
                    <td>
                      <span className={`status-pill pill-${item.status}`}>
                        {item.status === 'ready' ? 'Siap (Disetujui)' : item.status === 'moderation_pending' ? 'Dalam Moderasi' : item.status}
                      </span>
                    </td>
                    <td>{item.sizeBytes ? `${Math.round(item.sizeBytes / 1024)} KB` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
