import { BlenderComparison } from './BlenderComparison';
import { useBlenderModel } from './useBlenderModel';
import { Icon } from '../../design-system/Icon';
import { useStudioSnapshot } from '../../services/studioState';
import { Group } from 'three';
import { useEffect, useMemo, useState } from 'react';
import { MODEL3D_MAX_PARTS, validateModel3dRecipe, type Model3dRecipe } from '@forgekit/contracts';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';
import { ThreeViewport } from '../create/ThreeViewport';
import { modelStatistics } from '../create/geometry';
import { useModelBuildProgress } from './useModelBuildProgress';
import { ModelBuildOverlay } from './ModelBuildOverlay';

export function Model3dEditor({ id, initialVersionId, legacy, active = true, onStateChange }: {
  id?: string; initialVersionId?: string; legacy?: boolean; active?: boolean;
  onStateChange?: (state: { name?: string; versionId?: string; busy: boolean }) => void;
}) {
  const task = useCreativeTask('model3d', id ? { id: legacy ? '' : id, initialVersionId, restoreLatest: legacy } : undefined);
  const blender = useBlenderModel(task.version?.id);
  const building = task.busy || (blender.busy && !blender.importing);
  const manualBuild = blender.busy && !task.busy && !blender.importing;
  const progress = useModelBuildProgress(manualBuild ? undefined : task.attemptTaskId ?? undefined, manualBuild ? task.version?.id : undefined, building && active);
  const studio = useStudioSnapshot();
  const [recipe, setRecipe] = useState<Model3dRecipe | null>(null);
  const [editor, setEditor] = useState(''); const [selected, setSelected] = useState('');
  useEffect(() => {
    onStateChange?.({ name: task.version?.document.kind === 'model3d' ? task.version.document.recipe.name : undefined, versionId: task.version?.id, busy: task.busy || blender.busy });
  }, [task.version, task.busy, blender.busy, onStateChange]);
  useEffect(() => {
    if (task.version?.document.kind === 'model3d') {
      setRecipe(task.version.document.recipe); setEditor(JSON.stringify(task.version.document.recipe, null, 2)); setSelected('');
    }
  }, [task.version]);
  const emptyScene = useMemo(() => { const scene = new Group(); scene.name = 'Model 3D'; return scene; }, []);
  const changed = recipe && JSON.stringify(recipe) !== JSON.stringify(task.version?.document.recipe);
  const liveModel = building ? progress.model : null;
  const displayedModel = building ? liveModel ?? emptyScene : blender.model ?? emptyScene;
  const finalPreviewId = blender.bundle?.receipt.files?.find(file => file.relativePath.endsWith('/model.blend'))?.relativePath.replace(/\/model\.blend$/, '');
  const revealKey = liveModel ? progress.previewId : finalPreviewId && finalPreviewId === progress.previewId ? undefined : task.version?.id;
  const stats = useMemo(() => blender.model ? modelStatistics(blender.model) : null, [blender.model]);
  function preview() {
    try {
      const value: unknown = JSON.parse(editor);
      const errors = validateModel3dRecipe(value);
      if (errors.length) throw new Error(errors[0].message);
      setRecipe(value as Model3dRecipe); task.setError('');
    } catch (e) { task.setError(e instanceof Error ? e.message : 'JSON model tidak sah.'); }
  }
  return <section className="model-tab-panel" hidden={!active} aria-label="Editor Model 3D">
    <div className="procedural-layout">
      <aside className="generator-inspector" aria-label="Kontrol Model 3D">
        <CreativeControls task={{ ...task, busy: task.busy || blender.busy }} initialPrompt="" />
        <details><summary>Editor lanjutan</summary>
          <p className="generator-caption">Maks. {MODEL3D_MAX_PARTS} komponen · 200.000 triangle. Ukuran dan bevel dalam stud; rotasi dalam derajat.</p>
          <label htmlFor={`model-recipe-${id ?? "default"}`}>Recipe geometri</label><textarea id={`model-recipe-${id ?? "default"}`} className="recipe-editor" rows={12} value={editor} onChange={(e) => setEditor(e.target.value)} disabled={!recipe || task.busy} />
          <button type="button" className="button secondary-button" disabled={!recipe || task.busy} onClick={preview}>Periksa perubahan</button>
          <button type="button" className="button secondary-button" disabled={!changed || task.busy} onClick={() => void task.run('Revisi editor manual', task.version!.id, { kind: 'model3d', recipe: recipe! })}>Simpan revisi editor</button>
        </details>
      </aside>
      <div className="procedural-canvas model-blender-canvas">
        <div className="viewport-toolbar"><span>{liveModel ? `${displayedModel.name} · kandidat` : blender.bundle ? displayedModel.name : 'Hasil Blender'}</span>{stats && blender.bundle && !building && <span className="model-geometry-summary">{blender.bundle.receipt.metrics.triangles.toLocaleString('id-ID')} triangle</span>}</div>
        {blender.bundle?.receipt.referenceReview?.decision === 'revise' && <div role="status" className="generator-error"><strong>Belum sesuai referensi — perlu revisi.</strong><p>File model sudah tersimpan, tetapi pemeriksaan visual masih menemukan perbedaan.</p>{blender.bundle.receipt.referenceReview.differences.map((difference, index) => <p key={index}>{difference}</p>)}</div>}
        {active && <ThreeViewport object={displayedModel} onSelect={setSelected} label="Viewport hasil Blender" revealKey={displayedModel === emptyScene ? undefined : revealKey} emptyMessage={building ? undefined : 'Hasil Blender akan tampil di sini.'}
          overlay={building ? <ModelBuildOverlay phase={progress.phase} hasModel={!!liveModel} stopping={task.cancelling} provider={task.provider?.model} builtParts={progress.builtParts} totalParts={progress.totalParts} /> : undefined} />}
        <div className="viewport-footer model-blender-footer">
        {blender.error && <p role="alert" className="generator-error">{blender.error}</p>}
        {blender.notice && <p role="status" className="generator-caption">{blender.notice}</p>}
        {changed && <p className="generator-caption">Simpan revisi untuk membangun perubahan di Blender.</p>}
        <div className="generator-actions">
          {blender.busy ? <button type="button" className="button secondary-button" disabled={blender.importing} onClick={() => void blender.stop()}>{blender.importing ? 'Memasukkan…' : 'Hentikan Blender'}</button> : !blender.bundle && <button type="button" className="button primary-button" disabled={!recipe || !!changed || task.busy} onClick={() => void blender.build()}>Bangun di Blender</button>}
          {blender.bundle && <><button type="button" className="button secondary-button" disabled={task.busy || blender.busy} onClick={() => void blender.open()}>Buka di Blender</button><button type="button" className="button primary-button" disabled={task.busy || blender.busy || !!changed || !studio?.context} title={studio ? `Masukkan ke ${studio.studio.name}. Mesh diunggah ke pemilik map.` : 'Buka map di Roblox Studio.'} onClick={() => void blender.insert()}><Icon name="link" />Masukkan ke Studio</button><button type="button" className="theme-button" aria-label="Buka folder Blender" title="Folder .blend" onClick={() => void blender.reveal()}><Icon name="workspace" /></button></>}
        </div>
        {blender.bundle && <details className="viewport-validation model-result-details"><summary>Detail model</summary><p>{blender.bundle.receipt.metrics.parts} objek · {stats?.size.map(n => n.toFixed(2)).join(' × ')} stud · Blender {blender.bundle.receipt.metrics.blenderVersion}</p>{selected && <p>Pilihan: {displayedModel.children.find(part => part.userData.partId === selected)?.name ?? selected}</p>}<p>UV, collision dan kemiripan referensi perlu diperiksa.</p></details>}
        {blender.bundle?.receipt.metrics.reconstructions?.map(result => <p key={result.partId} className="generator-caption">Rekonstruksi siluet · {result.views.length} sudut. Rongga tersembunyi tetap perlu dibentuk; warna gambar masih memuat pencahayaan.</p>)}
        {blender.bundle && !!blender.bundle.references.length && <BlenderComparison references={blender.bundle.references} views={blender.bundle.views} review={blender.bundle.receipt.referenceReview} />}</div>
      </div>
    </div>
  </section>;
}
