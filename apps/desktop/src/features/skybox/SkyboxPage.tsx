import { useEffect, useRef, useState } from 'react';
import type { CubeFace, SkyboxRecipe } from '@forgekit/contracts';
import { hasBlockingSkyboxErrors, validateSkyboxRecipe } from '@forgekit/contracts';
import { isEditorRoute } from '../../app/featureRegistry';
import { Icon } from '../../design-system/Icon';
import {
  generateRobloxSkyScript, renderAllSkyboxFaces, renderSkyboxCubeNetSvg, skyboxPresetsData,
} from '../../engines/skybox/render';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';
import { SkyboxForm } from './SkyboxForm';
import { SkyboxPreview } from './SkyboxPreview';

const initialRecipe: SkyboxRecipe = {
  name: 'Langit Senja Keemasan', ...skyboxPresetsData.sunset, seed: 42,
};

function downloadSvg(svg: string, filename: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SkyboxPage() {
  const task = useCreativeTask('sky');
  const [recipe, setRecipe] = useState<SkyboxRecipe>(initialRecipe);
  const [status, setStatus] = useState('Draf belum digenerate atau disimpan.');
  const [view, setView] = useState<'controls' | 'preview'>('controls');
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const pendingOpen = useRef<string | null>(null);
  const dirty = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);
  const issues = validateSkyboxRecipe(recipe);
  const invalid = hasBlockingSkyboxErrors(issues);

  useEffect(() => {
    if (task.version?.document.kind === 'sky') {
      setRecipe(task.version.document.recipe);
      setStatus('Versi langit tersimpan dibuka. Belum diterapkan ke Studio.');
    }
  }, [task.version]);

  function render() {
    if (invalid) { setStatus('Perbaiki isian sebelum render atau ekspor.'); return false; }
    renderSkyboxCubeNetSvg(recipe);
    setStatus(`Skybox "${recipe.name}" berhasil dirender lokal.`);
    return true;
  }
  function save() {
    if (!task.busy && !invalid) void task.run('Simpan revisi editor langit', task.version?.id ?? null, { kind: 'sky', recipe });
  }
  async function open(id: string) {
    if (dirty) { pendingOpen.current = id; replaceDialog.current?.showModal(); }
    else await task.open(id);
  }
  async function copyLuauScript() {
    if (invalid) return;
    try {
      await navigator.clipboard.writeText(generateRobloxSkyScript(recipe));
      setStatus('Skrip Luau Roblox Sky & Lighting disalin ke clipboard.');
    } catch { setStatus('Gagal menyalin ke clipboard.'); }
  }
  function exportSvg(allFaces: boolean) {
    if (invalid) return;
    const name = recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'skybox';
    if (allFaces) {
      const faces = renderAllSkyboxFaces(recipe);
      (Object.keys(faces) as CubeFace[]).forEach((face) => downloadSvg(faces[face], `${name}_${face}.svg`));
    } else downloadSvg(renderSkyboxCubeNetSvg(recipe), `${name}-cube-net.svg`);
    setStatus(allFaces ? '6 sisi SVG diekspor. Upload Roblox memerlukan gambar raster.' : 'Jaring kubus SVG diekspor.');
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!isEditorRoute(window.location.hash, 'sky') || event.defaultPrevented || task.busy
        || document.querySelector('dialog[open], [aria-modal="true"]:not(dialog)')) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); render(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [recipe, task.busy, task.version]);

  return <div className="gfx-page skybox-page">
    <dialog className="replace-dialog" ref={replaceDialog}>
      <h2>Buang perubahan saat ini?</h2>
      <p>Draf editor akan diganti versi pilihan. Versi tersimpan tetap tersedia.</p>
      <div className="action-row">
        <button className="button secondary-button" type="button" onClick={() => { pendingOpen.current = null; replaceDialog.current?.close(); }}>Pertahankan draf</button>
        <button className="button primary-button" type="button" onClick={() => {
          const id = pendingOpen.current; pendingOpen.current = null; replaceDialog.current?.close(); if (id) void task.open(id);
        }}>Ganti dengan versi pilihan</button>
      </div>
    </dialog>
    <header className="page-header gfx-page-header">
      <div className="gfx-title-row"><span className="page-icon"><Icon name="sun" /></span><div>
        <h1>Generator Langit</h1>
        <p className="page-description">Prompt menjadi ilustrasi langit enam sisi dan parameter pencahayaan. Revisi dan versi tersimpan bersama task.</p>
      </div></div>
      <span className="document-state">{dirty ? 'Draf belum disimpan' : 'Versi tersimpan'}</span>
    </header>
    <div aria-label="Aksi skybox" className="editor-toolbar" role="group">
      <button className="button secondary-button" type="button" disabled={task.busy || invalid} onClick={render}>Render</button>
      <button className="button secondary-button" type="button" disabled={task.busy || invalid || !dirty} onClick={save}><Icon name="save" />Simpan versi</button>
      <button className="button secondary-button" type="button" disabled={task.busy || invalid} onClick={copyLuauScript}>Salin Skrip Luau</button>
      <button className="button secondary-button" type="button" disabled={task.busy || invalid} onClick={() => exportSvg(false)}>Ekspor Jaring (SVG)</button>
      <button className="button secondary-button" type="button" disabled={task.busy || invalid} onClick={() => exportSvg(true)}>Ekspor 6 Sisi</button>
      <button className="button secondary-button" type="button" disabled aria-describedby="skybox-apply-reason">Terapkan ke Studio</button>
    </div>
    <p id="skybox-apply-reason" className="generator-caption">Sambungan cubemap belum divalidasi. Upload enam gambar raster dan izin tulis Studio belum tersedia; salinan Luau hanya mengatur Lighting/Sky, tanpa memasang tekstur.</p>
    <div className="editor-switch" role="group" aria-label="Tampilan editor">
      <button aria-controls="skybox-controls" aria-pressed={view === 'controls'} className="button secondary-button" type="button" onClick={() => setView('controls')}>Pengaturan</button>
      <button aria-controls="skybox-preview" aria-pressed={view === 'preview'} className="button secondary-button" type="button" onClick={() => setView('preview')}>Pratinjau</button>
    </div>
    <div className="gfx-workspace skybox-workspace" data-view={view}>
      <SkyboxPreview recipe={recipe} onCopyScript={copyLuauScript} />
      <section aria-label="Brief Skybox" className="panel inspector" id="skybox-controls">
        <CreativeControls task={{ ...task, open }} initialPrompt="Buat langit senja keemasan" />
        <details open><summary>Editor lanjutan</summary><div className="editor-fields">
          <SkyboxForm issues={issues} onChange={(patch) => setRecipe((current) => ({ ...current, ...patch }))} onRender={render} recipe={recipe} />
        </div></details>
      </section>
    </div>
    <footer className="status-bar" role="status"><span>{status}</span><span className="shortcut-hint">Render: Cmd/Ctrl+Enter · Simpan: Cmd/Ctrl+S</span></footer>
  </div>;
}
