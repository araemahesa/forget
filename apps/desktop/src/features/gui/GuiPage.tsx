import { buildGuiScene } from './guiScene';
import { ThreeViewport } from '../create/ThreeViewport';
import { disposeGeometry } from '../create/geometry';
import { StudioApply } from '../create/StudioApply';
import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GuiElement, GuiRecipe } from '@forgekit/contracts';
import { validateGuiRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';

const defaultRecipe: GuiRecipe = {
  screenName: 'ShopScreenGui',
  targetDevice: 'desktop',
  elements: [
    {
      id: 'e1',
      type: 'Frame',
      name: 'MainPanel',
      size: [0.6, 0, 0.7, 0],
      position: [0.2, 0, 0.15, 0],
      backgroundColor: '#171a20',
      cornerRadius: 12,
    },
    {
      id: 'e2',
      type: 'TextLabel',
      name: 'HeaderTitle',
      size: [0.5, 0, 0.1, 0],
      position: [0.25, 0, 0.18, 0],
      backgroundColor: 'transparent',
      text: 'TOKO PERLENGKAPAN',
      textColor: '#f2f4f8',
    },
    {
      id: 'e3',
      type: 'TextButton',
      name: 'CloseButton',
      size: [0.15, 0, 0.08, 0],
      position: [0.62, 0, 0.72, 0],
      backgroundColor: '#d6002b',
      text: 'Tutup',
      textColor: '#ffffff',
      cornerRadius: 6,
    },
  ],
};

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function GuiPage() {
  const task = useCreativeTask('interface');
  const [recipe, setRecipe] = useState<GuiRecipe>(defaultRecipe);
  const [viewMode, setViewMode] = useState('3d');
  const scene = useMemo(() => buildGuiScene(recipe), [recipe]);
  useEffect(() => () => disposeGeometry(scene), [scene]);
  const [selectedElementId, setSelectedElementId] = useState<string>('e1');

  useEffect(() => {
    if (task.version?.document.kind === 'interface') {
      setRecipe(task.version.document.recipe);
      if (task.version.document.recipe.elements.length > 0) {
        setSelectedElementId(task.version.document.recipe.elements[0].id);
      }
    }
  }, [task.version]);

  const errors = validateGuiRecipe(recipe);
  const changed = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);
  const activeElement = recipe.elements.find((e) => e.id === selectedElementId) || recipe.elements[0];

  const addElement = (type: GuiElement['type']) => {
    const newId = `e${Date.now()}`;
    const newEl: GuiElement = {
      id: newId,
      type,
      name: `New_${type}`,
      size: [0.2, 0, 0.1, 0],
      position: [0.4, 0, 0.4, 0],
      backgroundColor: type === 'TextButton' ? '#d6002b' : '#272e39',
      text: type.includes('Text') ? 'Label Baru' : undefined,
      textColor: '#ffffff',
      cornerRadius: 6,
    };
    setRecipe({ ...recipe, elements: [...recipe.elements, newEl] });
    setSelectedElementId(newId);
  };

  function renderElements(parentId?: string): ReactNode {
    return recipe.elements.filter(el => el.parentId === parentId).map((el) => {
                const isSelected = el.id === selectedElementId;
                const style: React.CSSProperties = {
                  position: 'absolute',
                  left: `calc(${el.position[0] * 100}% + ${el.position[1]}px)`,
                  top: `calc(${el.position[2] * 100}% + ${el.position[3]}px)`,
                  width: `calc(${el.size[0] * 100}% + ${el.size[1]}px)`,
                  height: `calc(${el.size[2] * 100}% + ${el.size[3]}px)`,
                  transform: `translate(${-100 * (el.anchorPoint?.[0] ?? 0)}%, ${-100 * (el.anchorPoint?.[1] ?? 0)}%)`,
                  backgroundColor: el.backgroundColor,
                  borderRadius: `${el.cornerRadius || 0}px`,
                  color: el.textColor || '#fff',
                  border: isSelected ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontWeight: el.type === 'TextButton' ? 600 : 400,
                  fontSize: '13px',
                  userSelect: 'none',
                };
                return (
                  <div
                    key={el.id}
                    style={style}
                    role="button"
                    tabIndex={0}
                    aria-label={`Pilih ${el.name}`}
                    onClick={(event) => { event.stopPropagation(); setSelectedElementId(el.id); }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setSelectedElementId(el.id); } }}
                  >
                    {el.text || (el.type !== 'Frame' ? el.name : '')}
                    {renderElements(el.id)}
                  </div>
                );
    });
  }

  return (
    <section className="procedural-workspace">
      <div className="procedural-heading">
        <div>
          <h1>Antarmuka Game (GUI)</h1>
          <p>Prompt menjadi ScreenGui responsif dengan hierarki UDim2 untuk desktop, ponsel, dan tablet.</p>
        </div>
        <span className="capability-note">Roblox ScreenGui: Prosedural</span>
      </div>

      <div className="procedural-layout">
        <aside className="generator-inspector" aria-label="Kontrol Antarmuka Game">
          <CreativeControls task={task} initialPrompt="Buat antarmuka toko perlengkapan dengan tombol beli dan tutup." />

          <details>
            <summary>Editor lanjutan</summary>
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label htmlFor="gui-screen-name">Nama ScreenGui</label>
              <input
                id="gui-screen-name"
                className="text-input"
                value={recipe.screenName}
                onChange={(e) => setRecipe({ ...recipe, screenName: e.target.value })}
                disabled={task.busy}
              />
            </div>

            <div className="form-group">
              <label htmlFor="gui-device">Target Rasio Layar</label>
              <Dropdown
                id="gui-device"
                className="select-input"
                value={recipe.targetDevice}
                onChange={(e) => setRecipe({ ...recipe, targetDevice: e.target.value as GuiRecipe['targetDevice'] })}
                disabled={task.busy}
              >
                <option value="desktop">PC Desktop (1920 × 1080)</option>
                <option value="mobile">Ponsel / Smartphone (Vertical)</option>
                <option value="tablet">Tablet / iPad</option>
                <option value="console">Konsol TV (10-foot UI)</option>
              </Dropdown>
            </div>

            <div className="form-group">
              <label>Tambah Komponen UI</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <button className="button secondary-button btn-sm" onClick={() => addElement('Frame')} type="button" disabled={task.busy}>+ Frame</button>
                <button className="button secondary-button btn-sm" onClick={() => addElement('TextLabel')} type="button" disabled={task.busy}>+ Label</button>
                <button className="button secondary-button btn-sm" onClick={() => addElement('TextButton')} type="button" disabled={task.busy}>+ Tombol</button>
              </div>
            </div>

            {activeElement && (
              <div className="form-group">
                <label htmlFor="active-el-name">Edit: {activeElement.name}</label>
                <input
                  id="active-el-name"
                  className="text-input"
                  value={activeElement.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setRecipe({
                      ...recipe,
                      elements: recipe.elements.map((el) => (el.id === activeElement.id ? { ...el, name } : el)),
                    });
                  }}
                  disabled={task.busy}
                />
              </div>
            )}

            {errors.length > 0 && (
              <div className="alert alert-error" style={{ margin: '8px 0' }}>
                <Icon name="alert" />
                <span>{errors[0].message}</span>
              </div>
            )}

            <button
              type="button"
              className="button secondary-button"
              style={{ marginTop: '8px', width: '100%' }}
              disabled={!changed || errors.length > 0 || task.busy}
              onClick={() => void task.run('Revisi editor manual', task.version?.id ?? null, { kind: 'interface', recipe })}
            >
              Simpan revisi editor
            </button>
          </details>
        </aside>

        <div className="procedural-canvas">
          <div className="viewport-toolbar">
            <span>{recipe.screenName} ({recipe.targetDevice})</span>
            <label>Tampilan<Dropdown aria-label="Tampilan GUI" value={viewMode} onChange={event => setViewMode(event.target.value)}><option value="3d">Struktur 3D</option><option value="2d">Layar 2D</option></Dropdown></label><span className="small-tag">{recipe.elements.length} elemen</span>
          </div>

          {viewMode === '3d' ? <ThreeViewport object={scene} onSelect={setSelectedElementId} label="Struktur berlapis ScreenGui dalam 3D" /> : <div
            className="preview-canvas-content gui-canvas"
            style={{
              minHeight: '340px',
              background: '#0d0c0e',
              borderRadius: '10px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              className="gui-viewport-frame"
              style={{
                position: 'relative',
                width: recipe.targetDevice === 'mobile' ? '240px' : '480px',
                maxWidth: '100%',
                height: '300px',
                background: '#16141a',
                border: '1px solid var(--border-control)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {errors.length ? <p role="alert">{errors[0].message}</p> : renderElements()}
            </div>
          </div>}

          <p className="generator-caption" style={{ marginTop: '12px' }}>
            Struktur 3D memperlihatkan lapisan dan hierarki. Pilih Layar 2D untuk memeriksa komposisi ScreenGui.
          </p>

          <div className="generator-actions" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => downloadJson(recipe, `${recipe.screenName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_gui.json`)}
            >
              <Icon name="download" /> Ekspor JSON
            </button>
            <StudioApply task={task} changed={!!changed} />
          </div>
          <details className="preview-runtime-details"><summary>Penerapan & verifikasi Studio</summary><p id="gui-apply-reason" className="generator-caption">Versi tersimpan diterapkan melalui provider pilihan pada map terverifikasi. Target dikunci; hasil diperiksa kembali. Pemasangan di Edit tidak membuktikan perilaku saat Play.</p></details>
        </div>
      </div>
    </section>
  );
}
