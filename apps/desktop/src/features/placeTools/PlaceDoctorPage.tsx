import { useState } from 'react';
import type { PlaceDiagnosticIssue, PlaceDoctorRecipe } from '@forgekit/contracts';
import { validatePlaceDoctorRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: PlaceDoctorRecipe = {
  placeName: 'Tempat Utama Roblox',
  checkMemoryLeaks: true,
  checkUnanchoredParts: true,
  checkMissingCollision: true,
  checkScriptErrors: true,
  maxScanDepth: 15,
};

export function PlaceDoctorPage() {
  const [recipe, setRecipe] = useState<PlaceDoctorRecipe>(initialRecipe);
  const [isScanning, setIsScanning] = useState(false);
  const [issues, setIssues] = useState<PlaceDiagnosticIssue[]>([]);
  const [scanComplete, setScanComplete] = useState(false);
  const [fixedIssueIds, setFixedIssueIds] = useState<Set<string>>(new Set());

  const validationErrors = validatePlaceDoctorRecipe(recipe);

  const runScan = () => {
    if (validationErrors.length > 0) return;
    setIsScanning(true);
    setScanComplete(false);
    setTimeout(() => {
      const detected: PlaceDiagnosticIssue[] = [
        {
          id: 'iss-1',
          code: 'UNANCHORED_DECORATION',
          severity: 'warning',
          location: 'Workspace.Map.Trees.PineTree_04.Leaves',
          message: 'Part dekorasi tidak di-anchor dan dapat jatuh terkena fisika.',
          suggestedFix: 'Set Part.Anchored = true untuk menghemat kalkulasi physics engine.',
        },
        {
          id: 'iss-2',
          code: 'UNBOUNDED_CONNECTION',
          severity: 'error',
          location: 'ServerScriptService.LeaderboardManager:42',
          message: 'PlayerAdded event listener membuat koneksi tanpa cleanup saat PlayerRemoving.',
          suggestedFix: 'Disconnect event listener atau gunakan Maid/Janitor pattern.',
        },
        {
          id: 'iss-3',
          code: 'COMPLEX_COLLISION_GEOMETRY',
          severity: 'info',
          location: 'Workspace.Map.Buildings.CastleTower',
          message: 'CollisionFidelity PreciseConvexDecomposition pada mesh statis jauh.',
          suggestedFix: 'Ubah CollisionFidelity menjadi Box atau Hull untuk optimasi memori.',
        },
      ];
      setIssues(detected);
      setIsScanning(false);
      setScanComplete(true);
    }, 600);
  };

  const applyFix = (id: string) => {
    setFixedIssueIds((prev) => new Set(prev).add(id));
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="activity" />
          <h2>Pemeriksa Place</h2>
        </div>
        <p className="section-desc">Pindai place untuk mendeteksi memory leak, unanchored part, dan bottleneck performa.</p>

        <div className="form-group">
          <label htmlFor="doc-place-name">Nama Place Target</label>
          <input
            id="doc-place-name"
            className="text-input"
            value={recipe.placeName}
            onChange={(e) => setRecipe({ ...recipe, placeName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="doc-scan-depth">Kedalaman Scan (Hierarchy Depth)</label>
          <input
            id="doc-scan-depth"
            type="number"
            min={1}
            max={50}
            className="text-input"
            value={recipe.maxScanDepth}
            onChange={(e) => setRecipe({ ...recipe, maxScanDepth: Number(e.target.value) || 1 })}
          />
        </div>

        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.checkMemoryLeaks}
              onChange={(e) => setRecipe({ ...recipe, checkMemoryLeaks: e.target.checked })}
            />
            <span>Periksa Kebocoran Memori (Scripts)</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.checkUnanchoredParts}
              onChange={(e) => setRecipe({ ...recipe, checkUnanchoredParts: e.target.checked })}
            />
            <span>Periksa Unanchored Parts</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.checkMissingCollision}
              onChange={(e) => setRecipe({ ...recipe, checkMissingCollision: e.target.checked })}
            />
            <span>Periksa Geometri Tabrakan (Collision)</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.checkScriptErrors}
              onChange={(e) => setRecipe({ ...recipe, checkScriptErrors: e.target.checked })}
            />
            <span>Periksa Syntax & Deprecated Luau API</span>
          </label>
        </div>

        {validationErrors.length > 0 && (
          <div className="alert alert-error">
            <Icon name="alert" />
            <span>{validationErrors[0].message}</span>
          </div>
        )}

        <button
          className="button primary-button btn-full"
          disabled={isScanning || validationErrors.length > 0}
          onClick={runScan}
          type="button"
        >
          <Icon name="search" />
          <span>{isScanning ? 'Memindai Hierarchy...' : 'Mulai Diagnostik Place'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Laporan Diagnostik Studio</span>
            <span className="small-tag">{scanComplete ? `${issues.length} masalah ditemukan` : 'Siap'}</span>
          </div>
          <div className="preview-canvas-content">
            {!scanComplete && !isScanning && (
              <div className="empty-page">
                <Icon name="activity" />
                <h2>Belum ada diagnosa aktif.</h2>
                <p>Klik tombol 'Mulai Diagnostik Place' untuk memindai instance game Roblox.</p>
              </div>
            )}
            {isScanning && (
              <div className="empty-page">
                <div className="spinner" />
                <p>Menganalisis pohon objek Workspace, ReplicatedStorage, dan ServerScriptService...</p>
              </div>
            )}
            {scanComplete && issues.length > 0 && (
              <div className="issues-list">
                {issues.map((iss) => {
                  const isFixed = fixedIssueIds.has(iss.id);
                  return (
                    <div key={iss.id} className={`issue-card issue-${iss.severity} ${isFixed ? 'is-fixed' : ''}`}>
                      <div className="issue-header">
                        <span className={`issue-badge badge-${iss.severity}`}>{iss.severity.toUpperCase()}</span>
                        <code className="issue-loc">{iss.location}</code>
                      </div>
                      <p className="issue-msg">{iss.message}</p>
                      <div className="issue-fix">
                        <Icon name="tools" />
                        <span>{iss.suggestedFix}</span>
                      </div>
                      {!isFixed ? (
                        <button className="button secondary-button btn-sm" onClick={() => applyFix(iss.id)} type="button">
                          Perbaiki Otomatis
                        </button>
                      ) : (
                        <span className="fixed-label"><Icon name="check" /> Telah Diperbaiki</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
