import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeAnimation, evaluateClip, isAnimationDocument, migrateAnimationRecipe, validateAnimationDocument,
  type AnimationDocument, type AnimationMode, type AnimationQualityProfile, type AnimationQualityReport, type AnimationRecipe, type LoopMode,
} from '@forgekit/contracts';
import { StudioApply } from '../create/StudioApply';
import { Dropdown } from '../../design-system/Dropdown';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';
import { ThreeViewport } from '../create/ThreeViewport';
import { call, type ArtifactExport } from '../../services/tauri';
import { safeGetItem, safeSetItem } from '../../services/safeStorage';
import { applyPose, buildAnimationScene, exportAnimationGlb, footSlideCheck } from './animationScene';

const modes: { id: AnimationMode; label: string; hint: string; example: string }[] = [
  { id: 'character', label: 'Animasi Karakter', hint: 'Karakter, NPC, monster, robot: gerak, kemampuan, interaksi.', example: 'Karakter berjalan mundur sambil menyeimbangkan nampan, menoleh ke belakang dua kali, lalu berlutut perlahan. Tangan kiri tetap memegang nampan.' },
  { id: 'object', label: 'Animasi Objek 3D', hint: 'Pintu, peti, tuas, platform, mesin, rakitan beberapa bagian.', example: 'Pintu kayu berat: gagang berputar dulu, lalu daun pintu membuka 100 derajat dalam 1,2 detik dan menahan posisi terbuka. Kusen tetap diam.' },
];
const statusLabels: Record<string, string> = {
  satisfied: 'Terpenuhi', partial: 'Gerak terdeteksi', unsatisfied: 'Belum terpenuhi', unverifiable: 'Perlu tinjauan visual',
  pass: 'Lulus', warn: 'Peringatan', fail: 'Gagal', not_checked: 'Tidak diperiksa',
  draft: 'Draf', needs_revision: 'Perlu revisi', technically_verified: 'Terverifikasi teknis',
};
const FRAME = 1 / 30;

/** Saved v2 documents are used as-is; v1 Euler recipes are read through the migration. */
function readDocument(recipe: unknown): { doc: AnimationDocument; migrated: boolean } | null {
  if (!recipe) return null;
  if (isAnimationDocument(recipe)) return { doc: recipe, migrated: false };
  return { doc: migrateAnimationRecipe(recipe as AnimationRecipe), migrated: true };
}

export function AnimationPage() {
  const task = useCreativeTask('animation');
  const [mode, setMode] = useState<AnimationMode>(() => (safeGetItem('forgekit:animation-mode') === 'object' ? 'object' : 'character'));
  const [duration, setDuration] = useState('');
  const [loopMode, setLoopMode] = useState<'' | LoopMode>('');
  const [quality, setQuality] = useState<AnimationQualityProfile>('high_polish');
  useEffect(() => { safeSetItem('forgekit:animation-mode', mode); }, [mode]);
  useEffect(() => {
    const seconds = Number(duration);
    task.setRequestExtras({ animation: { mode, qualityProfile: quality, ...(duration && seconds > 0 ? { durationSeconds: seconds } : {}), ...(loopMode ? { loopMode } : {}) } });
  }, [mode, duration, loopMode, quality]);

  const saved = useMemo(() => (task.version?.document.kind === 'animation' ? readDocument(task.version.document.recipe) : null), [task.version]);
  const [draft, setDraft] = useState<AnimationDocument | null>(null);
  const [editor, setEditor] = useState('');
  useEffect(() => {
    setDraft(saved?.doc ?? null); setEditor(saved ? JSON.stringify(saved.doc, null, 2) : '');
    if (saved) setMode(saved.doc.animationMode);
    cursor.current = 0; setTime(0); setPlaying(false); setExportState(null);
  }, [saved]);
  const doc = draft;
  const changed = !!doc && !!saved && JSON.stringify(doc) !== JSON.stringify(saved.doc);

  const [clipId, setClipId] = useState('');
  const clip = doc?.clips.find((c) => c.id === clipId) ?? doc?.clips[0] ?? null;
  const scene = useMemo(() => (doc ? buildAnimationScene(doc) : null), [doc]);
  useEffect(() => () => scene?.dispose(), [scene]);

  const [time, setTime] = useState(0); const cursor = useRef(0);
  const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1);
  useEffect(() => { if (scene && clip) applyPose(scene, evaluateClip(clip, time)); }, [scene, clip, time]);
  function advance(elapsed: number) {
    if (!clip || !playing) return;
    cursor.current += elapsed * speed; // time-based: playback speed is independent of frame rate
    if (clip.loopMode === 'once' && cursor.current >= clip.durationSeconds) { cursor.current = clip.durationSeconds; setPlaying(false); }
    setTime(cursor.current);
  }
  const shown = clip ? (clip.loopMode === 'once' ? Math.min(time, clip.durationSeconds) : time % (clip.loopMode === 'pingpong' ? 2 * clip.durationSeconds : clip.durationSeconds)) : 0;
  function seek(value: number) { cursor.current = Math.max(0, value); setTime(cursor.current); setPlaying(false); }

  const report: AnimationQualityReport | null = useMemo(() => {
    if (!doc || !clip) return null;
    const probe = buildAnimationScene(doc); // separate scene: the check poses the rig at many times
    try { return analyzeAnimation(doc, doc.animationMode === 'character' ? [footSlideCheck(doc, probe, clip)] : []); }
    finally { probe.dispose(); }
  }, [doc, clip]);

  const [exportState, setExportState] = useState<{ verified: boolean; lines: string[]; path?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  async function exportAnimation() {
    if (!doc || !task.version || changed || exporting) return;
    setExporting(true); task.setError('');
    try {
      const result = await exportAnimationGlb(doc);
      if (!result.verified) { setExportState({ verified: false, lines: result.verification }); throw new Error(`Verifikasi baca-ulang GLB gagal: ${result.verification.join('; ')}`); }
      const saved = await call<ArtifactExport>('export_creative_geometry', { versionId: task.version.id, format: 'glb', bytes: Array.from(result.bytes) });
      setExportState({ verified: true, lines: result.verification, path: saved.relativePath });
      task.setNotice(`GLB tersimpan: ${saved.relativePath}. Bukan animation ID Roblox; publikasi tetap langkah terpisah.`);
    } catch (e) { task.setError(e instanceof Error ? e.message : 'Ekspor animasi gagal.'); }
    finally { setExporting(false); }
  }
  function previewEdits() {
    try {
      const value: unknown = JSON.parse(editor);
      const issues = isAnimationDocument(value) ? validateAnimationDocument(value) : [{ message: 'Gunakan AnimationDocument schemaVersion 2.' }];
      if (issues.length) throw new Error(issues[0].message);
      setDraft(value as AnimationDocument); seek(0); task.setError('');
    } catch (e) { task.setError(e instanceof Error ? e.message : 'Dokumen animasi tidak sah.'); }
  }

  const active = modes.find((m) => m.id === mode)!;
  const stages = [
    { id: 'artifact_ready', label: 'Artefak tersimpan', done: !!task.version },
    { id: 'preview_verified', label: 'Pratinjau dari gerak tersimpan', done: !!report && !changed },
    { id: 'export_verified', label: 'Ekspor dibaca ulang', done: !!exportState?.verified },
    { id: 'studio_applied', label: 'Diterapkan di Studio', done: false },
    { id: 'runtime_verified', label: 'Diuji di runtime Roblox', done: false },
  ];
  return <section className="procedural-workspace animation-studio">
    <div className="procedural-heading"><div><h1>Animasi</h1><p>Jelaskan geraknya dengan kata-katamu sendiri; ForgeKit menyusun dan memeriksa animasinya.</p></div>
      <span className="capability-note">{doc?.animationMode === 'object' ? 'Objek dari dokumen · pivot & hierarki' : 'Rig referensi Roblox R6/R15'}</span></div>
    <div className="animation-modes" role="tablist" aria-label="Mode animasi">
      {modes.map((m) => <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} disabled={task.busy} onClick={() => setMode(m.id)}><strong>{m.label}</strong><span>{m.hint}</span></button>)}
    </div>
    <div className="procedural-layout animation-layout">
      <aside className="generator-inspector" aria-label="Kontrol animasi">
        <CreativeControls key={mode} task={task} initialPrompt={active.example} promptLabel="Jelaskan animasi yang ingin kamu buat" promptPlaceholder="Tulis gerakan apa pun: urutan, arah, kecepatan, gaya, bagian yang harus diam…">
          <details className="animation-options"><summary>Kontrol tambahan (opsional)</summary>
            <p className="generator-caption">Prompt tetap yang utama. Bila kontrol bertentangan dengan teks, konfliknya dicatat di asumsi.</p>
            <label>Durasi (detik)<input type="number" min={0.1} max={120} step={0.1} value={duration} placeholder="Ikuti prompt" disabled={task.busy} onChange={(e) => setDuration(e.target.value)} /></label>
            <label>Pengulangan<Dropdown aria-label="Pengulangan" value={loopMode} disabled={task.busy} onChange={(e) => setLoopMode(e.target.value as '' | LoopMode)}><option value="">Ikuti prompt</option><option value="once">Sekali</option><option value="loop">Loop</option><option value="pingpong">Bolak-balik</option></Dropdown></label>
            <label>Profil kualitas<Dropdown aria-label="Profil kualitas" value={quality} disabled={task.busy} onChange={(e) => setQuality(e.target.value as AnimationQualityProfile)}><option value="high_polish">High Polish (default)</option><option value="production">Production</option><option value="draft">Draft cepat</option></Dropdown></label>
          </details>
        </CreativeControls>
        <details><summary>Dokumen animasi (lanjutan)</summary>
          <label htmlFor="animation-document">AnimationDocument v2</label>
          <textarea id="animation-document" rows={14} className="recipe-editor" value={editor} onChange={(e) => setEditor(e.target.value)} disabled={!doc || task.busy} />
          <button type="button" className="button secondary-button" disabled={!doc || task.busy} onClick={previewEdits}>Pratinjau perubahan</button>
          <button type="button" className="button secondary-button" disabled={!changed || task.busy} onClick={() => void task.run('Revisi editor manual', task.version!.id, { kind: 'animation', recipe: doc! })}>Simpan revisi editor</button>
        </details>
      </aside>
      <div className="procedural-canvas">
        <div className="viewport-toolbar"><span>{doc?.name ?? 'Belum ada animasi'}</span>
          <span>{doc ? (doc.animationMode === 'character' ? `${doc.character.rigType} · ${doc.character.rootPolicy === 'in_place' ? 'in-place' : 'root motion'} · ${doc.character.priority}` : `${doc.object.parts.length} bagian`) : active.label}{saved?.migrated ? ' · dimigrasikan dari v1' : ''}</span></div>
        {scene ? <ThreeViewport object={scene.group} onFrame={advance} label={doc?.animationMode === 'object' ? 'Viewport animasi objek' : 'Viewport animasi karakter'} />
          : <div className="animation-empty" role="status">Tulis prompt lalu buat animasi; pratinjau memutar gerak yang tersimpan, bukan klip contoh.</div>}
        <div className="motion-controls animation-timeline">
          {doc && doc.clips.length > 1 && <label>Clip<Dropdown aria-label="Clip" value={clip?.id ?? ''} onChange={(e) => { setClipId(e.target.value); seek(0); }}>{doc.clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Dropdown></label>}
          <button type="button" className="button secondary-button" aria-label="Frame sebelumnya" disabled={!clip} onClick={() => seek(shown - FRAME)}>◀</button>
          <button type="button" className="button secondary-button" disabled={!clip} onClick={() => { if (clip && clip.loopMode === 'once' && cursor.current >= clip.durationSeconds) seek(0); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
          <button type="button" className="button secondary-button" aria-label="Frame berikutnya" disabled={!clip} onClick={() => seek(shown + FRAME)}>▶</button>
          <div className="motion-scrubber">
            <input aria-label="Waktu animasi" type="range" min={0} max={clip?.durationSeconds ?? 1} step={0.01} value={Math.min(shown, clip?.durationSeconds ?? 1)} disabled={!clip} onChange={(e) => seek(Number(e.target.value))} />
            {clip && <div className="timeline-markers" aria-label="Marker">{clip.markers.map((m) => <button type="button" key={m.id} title={`${m.eventType} · ${m.timeSeconds.toFixed(2)} s`} style={{ left: `${(m.timeSeconds / clip.durationSeconds) * 100}%` }} onClick={() => seek(m.timeSeconds)}>{m.eventType}</button>)}</div>}
          </div>
          <output>{Math.min(shown, clip?.durationSeconds ?? 0).toFixed(2)} / {clip?.durationSeconds.toFixed(2) ?? '0.00'} s</output>
          <label>Kecepatan<Dropdown aria-label="Kecepatan playback" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></Dropdown></label>
        </div>
        <div className="generator-actions"><button type="button" className="button secondary-button" disabled={!doc || changed || task.busy || exporting} onClick={() => void exportAnimation()}>{exporting ? 'Mengekspor…' : 'Ekspor GLB + verifikasi'}</button><StudioApply task={task} changed={changed} /></div>
        {exportState && <p className={exportState.verified ? 'generator-caption' : 'status-error'} role="status">{exportState.lines.join(' ')}{exportState.path ? ` → ${exportState.path}` : ''}</p>}
      </div>
      {doc && report && <aside className="animation-report" aria-label="Laporan kualitas animasi">
        <header><h2>Laporan kualitas</h2><span className={`quality-badge is-${report.status}`}>{statusLabels[report.status]}</span></header>
        <section aria-label="Kepatuhan prompt"><h3>Kepatuhan prompt</h3>
          <ul className="requirement-list">{report.requirements.map((r) => <li key={r.id} className={`is-${r.status}`}>
            <span className="requirement-status">{statusLabels[r.status]}</span><strong>{r.text}</strong><q>{r.excerpt}</q><small>{r.evidence}</small></li>)}</ul>
        </section>
        <section aria-label="Pemeriksaan otomatis"><h3>Pemeriksaan otomatis</h3>
          <ul className="check-list">{report.checks.map((c) => <li key={c.id} className={`is-${c.status}`}><span className="requirement-status">{statusLabels[c.status]}</span><strong>{c.label}</strong><small>{c.detail}</small></li>)}</ul>
          <p className="generator-caption">{report.conditions}</p>
        </section>
        <section aria-label="Tahapan bukti"><h3>Tahapan</h3>
          <ul className="stage-list">{stages.map((s) => <li key={s.id} data-done={s.done}>{s.done ? '✓' : '○'} {s.label}</li>)}</ul>
        </section>
        {doc.motionIntent.assumptions.length > 0 && <section aria-label="Asumsi"><h3>Asumsi & batasan</h3><ul>{doc.motionIntent.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></section>}
        <section aria-label="Belum diperiksa"><h3>Belum diperiksa</h3><ul>{report.notChecked.map((n) => <li key={n}>{n}</li>)}</ul></section>
      </aside>}
    </div>
  </section>;
}
