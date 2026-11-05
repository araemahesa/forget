import { StudioApply } from '../create/StudioApply';
import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useMemo, useRef, useState } from 'react';
import { validateAnimationRecipe, type AnimationRecipe } from '@forgekit/contracts';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';
import { ThreeViewport } from '../create/ThreeViewport';
import { buildReferenceRig, disposeGeometry, evaluateMotion, exportGeometry, motionClip } from '../create/geometry';
import { call, type ArtifactExport } from '../../services/tauri';

export function AnimationPage() {
  const task = useCreativeTask('animation');
  const [recipe, setRecipe] = useState<AnimationRecipe | null>(null); const [editor, setEditor] = useState('');
  const [time, setTime] = useState(0); const cursor = useRef(0);
  const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1); const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (task.version?.document.kind === 'animation') {
      setRecipe(task.version.document.recipe); setEditor(JSON.stringify(task.version.document.recipe, null, 2));
      cursor.current = 0; setTime(0); setPlaying(false);
    }
  }, [task.version]);
  const rig = useMemo(() => buildReferenceRig(recipe?.rigType ?? 'R15'), [recipe?.rigType]);
  useEffect(() => () => { if (rig) disposeGeometry(rig.group); }, [rig]);
  useEffect(() => { if (rig && recipe) evaluateMotion(rig, recipe, time); }, [rig, recipe, time]);
  const changed = recipe && JSON.stringify(recipe) !== JSON.stringify(task.version?.document.recipe);
  function advance(elapsed: number) {
    if (!recipe || !rig || !playing) return;
    cursor.current += elapsed * speed;
    if (cursor.current >= recipe.duration) {
      if (recipe.loop) cursor.current %= recipe.duration;
      else { cursor.current = recipe.duration; setPlaying(false); }
    }
    evaluateMotion(rig, recipe, cursor.current); setTime(cursor.current);
  }
  function preview() {
    try {
      const value: unknown = JSON.parse(editor); const issues = validateAnimationRecipe(value);
      if (issues.length) throw new Error(issues[0].message);
      setRecipe(value as AnimationRecipe); cursor.current = 0; setTime(0); setPlaying(false); task.setError('');
    } catch (e) { task.setError(e instanceof Error ? e.message : 'Recipe animasi tidak sah.'); }
  }
  async function exportAnimation() {
    if (!recipe || !task.version || changed || exporting) return;
    setExporting(true); task.setError('');
    const source = task.version.document.recipe as AnimationRecipe;
    const output = buildReferenceRig(source.rigType);
    try {
      const bytes = await exportGeometry(output.group, 'glb', [motionClip(output, source)]);
      const result = await call<ArtifactExport>('export_creative_geometry', { versionId: task.version.id, format: 'glb', bytes: Array.from(bytes) });
      task.setNotice(`GLB reference rig + motion tersimpan: ${result.relativePath}. Bukan animation ID Roblox.`);
    } catch (e) { task.setError(e instanceof Error ? e.message : 'Ekspor motion gagal.'); }
    finally { disposeGeometry(output.group); setExporting(false); }
  }
  return <section className="procedural-workspace">
    <div className="procedural-heading"><div><h1>Animasi</h1><p>Buat gerakan dari prompt, periksa pose dan putar animasi pada rig Roblox R6/R15.</p></div><span className="capability-note">Mesh & Motor6D Roblox</span></div>
    <div className="procedural-layout">
      <aside className="generator-inspector" aria-label="Kontrol Animasi">
        <CreativeControls task={task} initialPrompt="Buat idle R15 bernapas halus, loop, kaki tetap menapak." />
        <details><summary>Timeline dan pose lanjutan</summary>
          <label htmlFor="animation-recipe">Recipe motion</label><textarea id="animation-recipe" rows={14} className="recipe-editor" value={editor} onChange={(e) => setEditor(e.target.value)} disabled={!recipe || task.busy} />
          <button type="button" className="button secondary-button" disabled={!recipe || task.busy} onClick={preview}>Pratinjau perubahan</button>
          <button type="button" className="button secondary-button" disabled={!changed || task.busy} onClick={() => void task.run('Revisi editor manual', task.version!.id, { kind: 'animation', recipe: recipe! })}>Simpan revisi editor</button>
          {recipe?.keyframes.map((frame, index) => <button key={frame.time} type="button" className="generator-version" onClick={() => { cursor.current = frame.time; setTime(frame.time); setPlaying(false); }}>Pose {index + 1} · {frame.time.toFixed(2)} s</button>)}
        </details>
      </aside>
      <div className="procedural-canvas">
        <div className="viewport-toolbar"><span>{recipe?.name ?? 'Belum ada motion'}</span><span>{recipe ? `${recipe.rigType} · ${recipe.priority} · ${recipe.loop ? 'Loop' : 'Sekali'}` : 'Rig Roblox R15 · Belum ada animasi'}</span></div>
        <ThreeViewport object={rig.group} onFrame={advance} label="Viewport animasi Roblox R6/R15" />
        <div className="motion-controls">
          <button type="button" className="button secondary-button" disabled={!recipe} onClick={() => { if (recipe && cursor.current >= recipe.duration) { cursor.current = 0; setTime(0); } setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
          <label className="motion-scrubber">Waktu<input aria-label="Waktu animasi" type="range" min={0} max={recipe?.duration ?? 1} step={.01} value={time} disabled={!recipe} onChange={(e) => { cursor.current = Number(e.target.value); setTime(cursor.current); setPlaying(false); }} /></label>
          <output>{time.toFixed(2)} / {recipe?.duration.toFixed(2) ?? '0.00'} s</output>
          <label>Kecepatan<Dropdown aria-label="Kecepatan playback" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></Dropdown></label>
        </div>
        <details className="preview-runtime-details"><summary>Detail pratinjau</summary><p className="generator-caption">Validasi: joint sesuai rig, rotasi terbatas, urutan waktu dan kesamaan pose loop. Interpolasi quaternion. Collision, foot sliding dan runtime Roblox belum diuji.</p></details>
        <div className="generator-actions"><button type="button" className="button secondary-button" disabled={!recipe || !!changed || task.busy || exporting} onClick={() => void exportAnimation()}>Ekspor rig + motion GLB</button><StudioApply task={task} changed={!!changed} /></div>
        <details className="preview-runtime-details"><summary>Penerapan & verifikasi Studio</summary><p id="animation-apply-reason" className="generator-caption">Versi tersimpan diterapkan melalui provider pilihan pada map terverifikasi. Target dikunci; hasil diperiksa kembali. Pemasangan di Edit tidak membuktikan perilaku saat Play.</p></details>
      </div>
    </div>
  </section>;
}
