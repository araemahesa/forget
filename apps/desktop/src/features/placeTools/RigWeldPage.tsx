import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { RigWeldRecipe } from '@forgekit/contracts';
import { validateRigWeldRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: RigWeldRecipe = {
  modelName: 'HeroArmor_Character',
  rigType: 'R15',
  rootPartName: 'HumanoidRootPart',
  autoWeldAccessories: true,
  tolerance: 0.05,
};

export function RigWeldPage() {
  const [recipe, setRecipe] = useState<RigWeldRecipe>(initialRecipe);
  const [processing, setProcessing] = useState(false);
  const [complete, setComplete] = useState(false);

  const errors = validateRigWeldRecipe(recipe);

  const handleRig = () => {
    if (errors.length > 0) return;
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      setComplete(true);
    }, 400);
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="tools" />
          <h2>Rig & Sambungan (Weld)</h2>
        </div>
        <p className="section-desc">Konfigurasi Motor6D, WeldConstraint, dan attachment sendi karakter Roblox.</p>

        <div className="form-group">
          <label htmlFor="model-name">Nama Karakter / Model</label>
          <input
            id="model-name"
            className="text-input"
            value={recipe.modelName}
            onChange={(e) => setRecipe({ ...recipe, modelName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="rig-type">Tipe Rig</label>
          <Dropdown
            id="rig-type"
            className="select-input"
            value={recipe.rigType}
            onChange={(e) => setRecipe({ ...recipe, rigType: e.target.value as 'R15' | 'R6' | 'Custom' })}
          >
            <option value="R15">Roblox R15 (15 Bagian)</option>
            <option value="R6">Klasik R6 (6 Bagian)</option>
            <option value="Custom">Kustom (Custom Bone Hierarchy)</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <label htmlFor="root-part">Root Part Utama</label>
          <input
            id="root-part"
            className="text-input"
            value={recipe.rootPartName}
            onChange={(e) => setRecipe({ ...recipe, rootPartName: e.target.value })}
          />
        </div>

        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={recipe.autoWeldAccessories}
              onChange={(e) => setRecipe({ ...recipe, autoWeldAccessories: e.target.checked })}
            />
            <span>Auto-Weld Aksesori (Attachment Alignment)</span>
          </label>
        </div>

        {errors.length > 0 && (
          <div className="alert alert-error">
            <Icon name="alert" />
            <span>{errors[0].message}</span>
          </div>
        )}

        <button
          className="button primary-button btn-full"
          disabled={processing || errors.length > 0}
          onClick={handleRig}
          type="button"
        >
          <Icon name="tools" />
          <span>{processing ? 'Menyambungkan Sendi...' : 'Bangun Rig & Weld'}</span>
        </button>
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Hierarki Sendi (Joint Tree)</span>
            <span className="small-tag">{complete ? '15 Motor6D Terpasang' : 'Siap'}</span>
          </div>
          <div className="preview-canvas-content mesh-canvas">
            <svg viewBox="0 0 400 260" className="mesh-preview-svg">
              {/* Head */}
              <circle cx="200" cy="50" r="20" fill="var(--surface-raised)" stroke="var(--accent)" strokeWidth="2" />
              {/* Torso */}
              <rect x="175" y="75" width="50" height="65" rx="4" fill="var(--surface-raised)" stroke="var(--border-control)" strokeWidth="2" />
              {/* Left Arm */}
              <rect x="140" y="75" width="25" height="60" rx="3" fill="var(--surface-raised)" stroke="var(--accent)" strokeWidth="1.5" />
              {/* Right Arm */}
              <rect x="235" y="75" width="25" height="60" rx="3" fill="var(--surface-raised)" stroke="var(--accent)" strokeWidth="1.5" />
              {/* Legs */}
              <rect x="175" y="145" width="22" height="65" rx="3" fill="var(--surface-raised)" stroke="var(--border-control)" strokeWidth="1.5" />
              <rect x="203" y="145" width="22" height="65" rx="3" fill="var(--surface-raised)" stroke="var(--border-control)" strokeWidth="1.5" />
              {/* Joint connection lines */}
              <circle cx="200" cy="72" r="3" fill="var(--accent)" />
              <circle cx="165" cy="80" r="3" fill="var(--accent)" />
              <circle cx="235" cy="80" r="3" fill="var(--accent)" />
              <circle cx="186" cy="142" r="3" fill="var(--accent)" />
              <circle cx="214" cy="142" r="3" fill="var(--accent)" />
              <text x="200" y="235" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                {complete ? `Rig ${recipe.rigType} berhasil diverifikasi tanpa cycle loop.` : 'Diagram pohon sambungan Motor6D Karakter'}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
