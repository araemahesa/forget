import { GeneratorEmpty } from '../create/GeneratorEmpty';
import { useEffect, useRef, useState } from 'react';
import { validateMusicRecipe, type MusicRecipe } from '@forgekit/contracts';
import { isEditorRoute } from '../../app/featureRegistry';
import { renderWaveformSvg, type SynthesizedAudio } from '../../engines/sfx/dsp';
import { synthesizeMusicAsync } from '../../engines/music/worker';
import { pitchFrequency } from '../../engines/music/render';
import { call, type ArtifactExport } from '../../services/tauri';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';

export function MusicPage() {
  const task = useCreativeTask('music');
  const [recipe, setRecipe] = useState<MusicRecipe | null>(null);
  const [editor, setEditor] = useState('');
  const [audio, setAudio] = useState<{ recipe: MusicRecipe; result: SynthesizedAudio; url: string } | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const audioData = audio?.recipe === recipe ? audio : null;
  const changed = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);
  useEffect(() => {
    if (task.version?.document.kind === 'music') {
      setRecipe(task.version.document.recipe);
      setEditor(JSON.stringify(task.version.document.recipe, null, 2));
    }
  }, [task.version]);
  useEffect(() => {
    if (!recipe) return;
    const controller = new AbortController();
    let url: string | undefined;
    setAudio(null); setSynthesizing(true);
    void synthesizeMusicAsync(recipe, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(new Blob([new Uint8Array(result.wavBytes)], { type: 'audio/wav' }));
      setAudio({ recipe, result, url });
    }).catch((error: Error) => {
      if (!controller.signal.aborted) task.setError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setSynthesizing(false); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [recipe]);
  useEffect(() => {
    const stop = () => { if (!isEditorRoute(location.hash, 'audio', 'music')) player.current?.pause(); };
    window.addEventListener('hashchange', stop);
    return () => { window.removeEventListener('hashchange', stop); player.current?.pause(); };
  }, []);
  function preview() {
    try {
      const value: unknown = JSON.parse(editor);
      const issues = validateMusicRecipe(value);
      if (issues.length) throw new Error(issues[0].message);
      setRecipe(value as MusicRecipe); task.setError('');
    } catch (error) { task.setError(error instanceof Error ? error.message : 'Partitur tidak sah.'); }
  }
  async function exportAudio() {
    if (!audioData || !task.version || changed || exporting) return;
    setExporting(true); task.setError('');
    try {
      const result = await call<ArtifactExport>('export_creative_audio', { versionId: task.version.id, bytes: Array.from(audioData.result.wavBytes) });
      task.setNotice(`WAV musik tersimpan: ${result.relativePath}. Belum diunggah ke Roblox.`);
    } catch (error) { task.setError(error instanceof Error ? error.message : 'Ekspor musik gagal.'); }
    finally { setExporting(false); }
  }
  return <section className="procedural-workspace">
    <div className="procedural-heading"><div><h1>Musik</h1><p>Prompt menjadi partitur dengan sintesis instrumen lokal, waveform, playback dan ekspor WAV.</p></div><span className="capability-note">Synth lokal, bukan rekaman orkestra</span></div>
    <div className="procedural-layout">
      <aside className="generator-inspector" aria-label="Kontrol Musik">
        <CreativeControls task={task} initialPrompt="Buat komposisi musik pertempuran tempo cepat." />
        <details><summary>Editor partitur</summary>
          <label htmlFor="music-recipe">Nada, instrumen dan waktu dalam detik</label>
          <textarea id="music-recipe" className="recipe-editor" rows={16} value={editor} disabled={!recipe || task.busy} onChange={(event) => setEditor(event.target.value)} />
          <button type="button" className="button secondary-button" disabled={!recipe || task.busy} onClick={preview}>Pratinjau perubahan</button>
          <button type="button" className="button secondary-button" disabled={!recipe || !changed || task.busy} onClick={() => void task.run('Revisi editor manual', task.version?.id ?? null, { kind: 'music', recipe: recipe! })}>Simpan revisi editor</button>
          <p className="generator-caption">Pitch C0-B8, maksimal 4096 nada. Revisi prompt memakai provider pilihan. Periksa kembali tempo dan timing nada melalui playback. Versi lama tanpa nada tetap dapat dibuka dan diedit.</p>
        </details>
      </aside>
      <div className="procedural-canvas">
        <div className="viewport-toolbar"><span>{recipe?.title ?? 'Belum ada partitur'}</span><span>{recipe ? `${recipe.bpm} BPM / ${recipe.key} ${recipe.scale} / ${recipe.durationSeconds.toFixed(2)} s` : 'Prosedural'}</span></div>
        {recipe ? <div className="music-output">
          <div className="music-tracks" aria-label="Partitur musik">
            {recipe.tracks.map((track) => <div className="music-track" key={track.id}>
              <div><strong>{track.name}</strong><span>{track.instrument} / {track.notes.length} nada / volume {Math.round(track.volume * 100)}%</span></div>
              <svg role="img" aria-label={`Nada ${track.name}`} viewBox="0 0 600 48" preserveAspectRatio="none">
                {track.notes.map((note, i) => <rect key={i} x={note.time / recipe.durationSeconds * 600} y={40 - Math.log2(pitchFrequency(note.pitch) / 16.35) / 9 * 36} width={Math.max(.5, note.duration / recipe.durationSeconds * 600)} height={6} fill="currentColor"><title>{note.pitch}: {note.time.toFixed(2)} s, durasi {note.duration.toFixed(2)} s</title></rect>)}
              </svg>
            </div>)}
          </div>
          {synthesizing && <p role="status">Menyintesis partitur...</p>}
          {audioData && <>
            <div className="music-waveform" aria-label="Waveform musik hasil sintesis" role="img" dangerouslySetInnerHTML={{ __html: renderWaveformSvg(audioData.result.waveformPeaks) }} />
            <audio ref={player} aria-label="Playback musik" controls src={audioData.url} onError={() => task.setError('Audio gagal diputar. Ulangi sintesis atau ekspor WAV.')} />
            <p className="generator-caption">PCM16 mono 22.05 kHz / peak {audioData.result.analysis.peakDbfs} dBFS / RMS {audioData.result.analysis.rms}. Limiter lokal; loudness LUFS belum diukur.</p>
          </>}
        </div> : <GeneratorEmpty icon="music" title="Komposisi yang dapat didengar">Perencana lokal membuat motif melodi, bass dan perkusi. Pilih provider untuk partitur lain; validasi nada tetap berlaku.</GeneratorEmpty>}
        <div className="generator-actions"><button type="button" className="button secondary-button" disabled={!audioData || changed || task.busy || exporting} onClick={() => void exportAudio()}>{exporting ? 'Menyimpan WAV...' : 'Ekspor WAV musik'}</button><button type="button" className="button secondary-button" disabled aria-describedby="music-apply-reason">Terapkan ke Studio</button></div>
        <p id="music-apply-reason" className="generator-caption">Penerapan belum tersedia: upload Sound asset ID, moderasi Roblox dan adapter Studio tulis belum aktif.</p>
      </div>
    </div>
  </section>;
}
