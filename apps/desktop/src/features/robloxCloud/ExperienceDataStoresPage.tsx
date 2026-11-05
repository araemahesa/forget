import { useState } from 'react';
import type { DataStoreRecord, RobloxExperienceConfig } from '@forgekit/contracts';
import { validateRobloxExperienceConfig } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialExp: RobloxExperienceConfig = {
  universeId: '592019482',
  placeId: '1492049281',
  experienceName: 'Legenda Nusantara: Petualangan Rimba',
  maxPlayers: 40,
  genre: 'Adventure',
};

const initialRecords: DataStoreRecord[] = [
  { key: 'Player_12345678', scope: 'global', value: '{"coins": 450, "level": 12, "inventory": ["iron_sword", "health_pot"]}', versionId: 'v3', updatedAt: '2026-10-27 10:14:02' },
  { key: 'Player_87654321', scope: 'global', value: '{"coins": 1200, "level": 28, "inventory": ["flame_bow", "dragon_shield"]}', versionId: 'v8', updatedAt: '2026-10-27 11:02:45' },
  { key: 'Server_GlobalQuest', scope: 'global', value: '{"questId": "boss_hydra", "defeated": false, "timer": 3600}', versionId: 'v1', updatedAt: '2026-10-27 09:30:11' },
];

export function ExperienceDataStoresPage() {
  const [exp, setExp] = useState<RobloxExperienceConfig>(initialExp);
  const [records, setRecords] = useState<DataStoreRecord[]>(initialRecords);
  const [selectedRecord, setSelectedRecord] = useState<DataStoreRecord>(initialRecords[0]);
  const [activeTab, setActiveTab] = useState<'datastores' | 'analytics'>('datastores');

  const errors = validateRobloxExperienceConfig(exp);

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="world" />
          <h2>Experience & Data Stores</h2>
        </div>
        <p className="section-desc">Inspeksi DataStore game, revisi entri JSON, dan pantau analitik pemain.</p>

        <div className="form-group">
          <label htmlFor="exp-universe-id">Roblox Universe ID</label>
          <input
            id="exp-universe-id"
            className="text-input"
            value={exp.universeId}
            onChange={(e) => setExp({ ...exp, universeId: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="exp-place-id">Start Place ID</label>
          <input
            id="exp-place-id"
            className="text-input"
            value={exp.placeId}
            onChange={(e) => setExp({ ...exp, placeId: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label>Mode Tampilan</label>
          <div className="btn-group-row">
            <button
              className={`button ${activeTab === 'datastores' ? 'primary-button' : 'secondary-button'} btn-sm`}
              onClick={() => setActiveTab('datastores')}
              type="button"
            >
              Data Stores
            </button>
            <button
              className={`button ${activeTab === 'analytics' ? 'primary-button' : 'secondary-button'} btn-sm`}
              onClick={() => setActiveTab('analytics')}
              type="button"
            >
              Analitik Game
            </button>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="alert alert-error">
            <Icon name="alert" />
            <span>{errors[0].message}</span>
          </div>
        )}
      </div>

      <div className="creator-preview-pane">
        {activeTab === 'datastores' ? (
          <div className="preview-card">
            <div className="preview-header">
              <span className="preview-title">DataStore: PlayerData ({records.length} Kunci)</span>
              <span className="small-tag">Versi Terkini</span>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Scope</th>
                    <th>Nilai JSON</th>
                    <th>Versi</th>
                    <th>Waktu Diperbarui</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr
                      key={rec.key}
                      className={rec.key === selectedRecord?.key ? 'is-selected' : ''}
                      onClick={() => setSelectedRecord(rec)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td><code>{rec.key}</code></td>
                      <td>{rec.scope}</td>
                      <td><span className="json-snippet">{rec.value.slice(0, 32)}…</span></td>
                      <td><span className="small-tag">{rec.versionId}</span></td>
                      <td>{rec.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedRecord && (
              <div className="record-inspector">
                <h4>Isi Nilai Kunci: <code>{selectedRecord.key}</code></h4>
                <pre className="code-inspector">{JSON.stringify(JSON.parse(selectedRecord.value), null, 2)}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="preview-card">
            <div className="preview-header">
              <span className="preview-title">Metrik Retensi & Pengguna Aktif</span>
              <span className="small-tag">7 Hari Terakhir</span>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Daily Active Users (DAU)</span>
                <span className="stat-value highlight">14,250</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Rata-rata Durasi Main</span>
                <span className="stat-value">22.4 Menit</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Retensi Hari ke-1</span>
                <span className="stat-value">38.2%</span>
              </div>
            </div>
            <div className="preview-canvas-content mesh-canvas">
              <svg viewBox="0 0 400 180" className="mesh-preview-svg">
                <polyline
                  points="40,140 100,120 160,80 220,95 280,60 340,40"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="3"
                />
                <circle cx="340" cy="40" r="5" fill="var(--accent)" />
                <text x="340" y="30" textAnchor="middle" fill="var(--text-secondary)" fontSize="11">14.2k</text>
                <text x="200" y="165" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                  Grafik pertumbuhan sesi pemain (DAU) 7 hari
                </text>
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
