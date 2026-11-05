import { StudioApply } from '../create/StudioApply';
import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useMemo, useRef, useState } from 'react';
import { validateCutsceneRecipe, type CutsceneRecipe } from '@forgekit/contracts';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';
import { ThreeViewport } from '../create/ThreeViewport';
import { buildReferenceRig, disposeGeometry } from '../create/geometry';
import { buildCutscenePreview, cutsceneLuau } from './cutscene';

export function CutscenePage() {
  const task = useCreativeTask('cutscene');
  const [recipe, setRecipe] = useState<CutsceneRecipe | null>(null);
  const [editor, setEditor] = useState('');
  const [time, setTime] = useState(0);
  const cursor = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState('path');
  const reference = useMemo(() => buildReferenceRig('R15'), []);
  useEffect(() => () => disposeGeometry(reference.group), [reference]);
  const preview = useMemo(() => recipe ? buildCutscenePreview(recipe) : null, [recipe]);
  const changed = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);
  useEffect(() => {
    if (task.version?.document.kind === 'cutscene') {
      setRecipe(task.version.document.recipe); setEditor(JSON.stringify(task.version.document.recipe, null, 2));
      cursor.current = 0; setTime(0); setPlaying(false);
    }
  }, [task.version]);
  useEffect(() => () => { if (preview) disposeGeometry(preview.group); }, [preview]);
  useEffect(() => { if (preview) { preview.helper.visible = mode === 'path'; preview.update(time); } }, [preview, mode, time]);
  function advance(elapsed: number) {
    if (!recipe || !playing || !preview) return;
    cursor.current += elapsed;
    if (cursor.current >= recipe.duration) {
      if (recipe.loop) cursor.current %= recipe.duration;
      else { cursor.current = recipe.duration; setPlaying(false); }
    }
    preview.update(cursor.current); setTime(cursor.current);
  }
  function openPreview() {
    try {
      const value: unknown = JSON.parse(editor), issues = validateCutsceneRecipe(value);
      if (issues.length) throw new Error(issues[0].message);
      setRecipe(value as CutsceneRecipe); cursor.current = 0; setTime(0); setPlaying(false); task.setError('');
    } catch (error) { task.setError(error instanceof Error ? error.message : 'Recipe kamera tidak sah.'); }
  }
  function download(format: 'json' | 'luau') {
    if (!recipe) return;
    const text = format === 'luau' ? cutsceneLuau(recipe) : JSON.stringify(recipe, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `cutscene.${format}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    task.setNotice(`Ekspor ${format.toUpperCase()} dibuat dari recipe yang dipratinjau. Belum dijalankan di Studio.`);
  }
  return <section className="procedural-workspace">
    <div className="procedural-heading"><div><h1>Cutscene</h1><p>Prompt menjadi lintasan kamera dengan playback posisi, orientasi, FOV dan easing.</p></div><span className="capability-note">Scene referensi lokal</span></div>
    <div className="procedural-layout">
      <aside className="generator-inspector" aria-label="Kontrol Cutscene">
        <CreativeControls task={task} initialPrompt="Buat shot sinematik kamera terbang mendekati gerbang utama." />
        <details><summary>Editor keyframe</summary>
          <label htmlFor="cutscene-recipe">Posisi, lookAt, waktu, FOV dan easing</label>
          <textarea id="cutscene-recipe" rows={16} className="recipe-editor" value={editor} disabled={!recipe || task.busy} onChange={(event) => setEditor(event.target.value)} />
          <button type="button" className="button secondary-button" disabled={!recipe || task.busy} onClick={openPreview}>Pratinjau perubahan</button>
          <button type="button" className="button secondary-button" disabled={!recipe || !changed || task.busy} onClick={() => void task.run('Revisi editor manual', task.version?.id ?? null, { kind: 'cutscene', recipe: recipe! })}>Simpan revisi editor</button>
          {recipe?.keyframes.map((frame, index) => <button type="button" className="generator-version" key={frame.time} onClick={() => { cursor.current = frame.time; setTime(frame.time); setPlaying(false); }}>Shot {index + 1} / {frame.time} s / FOV {frame.fov} / {frame.easing}</button>)}
        </details>
      </aside>
      <div className="procedural-canvas">
        <div className="viewport-toolbar"><span>{recipe?.title ?? 'Belum ada lintasan kamera'}</span><label>Tampilan<Dropdown aria-label="Mode pratinjau cutscene" value={mode} onChange={(event) => setMode(event.target.value)}><option value="path">Lintasan 3D</option><option value="camera">Sudut kamera</option></Dropdown></label></div>
        <ThreeViewport object={preview?.group ?? reference.group} previewCamera={preview && mode === 'camera' ? preview.camera : undefined} onFrame={advance} label="Viewport kamera Cutscene" />
        <div className="motion-controls">
          <button type="button" className="button secondary-button" disabled={!recipe} onClick={() => { if (recipe && cursor.current >= recipe.duration) { cursor.current = 0; setTime(0); } setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
          <label className="motion-scrubber">Waktu<input aria-label="Waktu cutscene" type="range" min={0} max={recipe?.duration ?? 1} step={.01} value={time} disabled={!recipe} onChange={(event) => { cursor.current = Number(event.target.value); setTime(cursor.current); setPlaying(false); }} /></label>
          <output>{time.toFixed(2)} / {recipe?.duration.toFixed(2) ?? '0.00'} s</output>
        </div>
        <details className="preview-runtime-details"><summary>Detail pratinjau</summary><p className="generator-caption">Posisi linear, rotasi quaternion, easing InOut menuju keyframe berikutnya. Rig Roblox R15 menjadi acuan skala; occlusion dan actor binding map belum diperiksa. Luau mengembalikan kamera saat selesai/dihentikan; runtime Roblox belum diuji.</p></details>
        <div className="generator-actions"><button type="button" className="button secondary-button" disabled={!recipe} onClick={() => download('json')}>Ekspor JSON</button><button type="button" className="button secondary-button" disabled={!recipe} onClick={() => download('luau')}>Ekspor LocalScript Luau</button><StudioApply task={task} changed={!!changed} /></div>
        <details className="preview-runtime-details"><summary>Penerapan & verifikasi Studio</summary><p id="cutscene-apply-reason" className="generator-caption">Versi tersimpan diterapkan melalui provider pilihan pada map terverifikasi. Target dikunci; hasil diperiksa kembali. Pemasangan di Edit tidak membuktikan perilaku saat Play.</p></details>
      </div>
    </div>
  </section>;
}
