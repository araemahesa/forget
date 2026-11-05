import { EditorAiPromptBar } from '../shared/EditorAiPromptBar';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SfxRecipe, ValidationIssue } from '@forgekit/contracts';
import { hasBlockingSfxErrors, validateSfxRecipe } from '@forgekit/contracts';
import { isEditorRoute } from '../../app/featureRegistry';
import { useCreatorDraft } from '../useCreatorDraft';
import { runCreatorTask, type CreatorTaskContext } from '../../services/creatorTasks';
import { Button } from '../../design-system/Button';
import { Icon } from '../../design-system/Icon';
import { Status } from '../../design-system/Status';
import { renderWaveformSvg, sfxPresets, type SynthesizedAudio } from '../../engines/sfx/dsp';
import { synthesizeSfxAsync } from '../../engines/sfx/worker';
import { listSfxVersions, loadSfxVersion, saveSfxVersion, exportSfxVersion, type SavedSfxVersion } from '../../services/sfx';
import { SfxForm } from './SfxForm';
import { SfxPreview } from './SfxPreview';

const initialRecipe: SfxRecipe = { name: 'Tembakan Laser Sci-Fi', ...sfxPresets.laser, seed: 42 };

function sameRecipe(left: SfxRecipe, right: SfxRecipe): boolean {
  return (Object.keys(initialRecipe) as (keyof SfxRecipe)[]).every((key) => left[key] === right[key]);
}

type Work = 'synthesizing' | 'saving' | 'opening' | 'exporting';

export function SfxPage() {
  const [recipe, setRecipe] = useState<SfxRecipe>(initialRecipe);
  const [baseline, setBaseline] = useState<SfxRecipe>(initialRecipe);
  const dirty = !sameRecipe(recipe, baseline);
  const [audioData, setAudioData] = useState<SynthesizedAudio | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [status, setStatus] = useState('Draf belum disintesis.');
  const [statusTone, setStatusTone] = useState<'neutral' | 'error' | 'success'>('neutral');
  const [historyError, setHistoryError] = useState('');
  const [versions, setVersions] = useState<SavedSfxVersion[]>([]);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const [work, setWork] = useState<Work | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(0.35);
  const [view, setView] = useState<'controls' | 'preview'>('controls');
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const pendingOpen = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const savedVersion = versions.find((v) => v.id === savedVersionId && !dirty) ?? null;
  const waveformSvg = audioData ? renderWaveformSvg(audioData.waveformPeaks, 480, 120) : '';
  const draft = useCreatorDraft<SfxRecipe>('sfx', async (stored) => {
    setRecipe(stored.spec);
    if (stored.baselineVersionId) {
      try {
        const loaded = await loadSfxVersion(stored.baselineVersionId);
        setBaseline(loaded.version.recipe); setSavedVersionId(stored.baselineVersionId);
      } catch (error) {
        setStatus(`Draf dipulihkan; versi acuan gagal diperiksa: ${error instanceof Error ? error.message : 'Versi tidak tersedia.'}`);
        setStatusTone('error');
      }
    }
  });
  const busy = work !== null || !draft.ready;
  const ready = useRef(draft.ready);
  ready.current = draft.ready;

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio.src = ''; }
    if (audioUrl.current) { URL.revokeObjectURL(audioUrl.current); audioUrl.current = null; }
    setIsPlaying(false);
  }, []);

  const handlePlayToggle = () => {
    if (isPlaying) { stopAudio(); return; }
    if (!audioData || busy) return;
    stopAudio();
    const url = URL.createObjectURL(new Blob([new Uint8Array(audioData.wavBytes)], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audioRef.current = audio;
    audioUrl.current = url;
    audio.loop = recipe.loop;
    audio.volume = previewVolume;
    audio.onended = stopAudio;
    const playbackError = () => {
      if (audioRef.current !== audio) return;
      stopAudio(); setStatus('Audio gagal diputar. Ulangi pemutaran atau ekspor WAV.'); setStatusTone('error');
    };
    audio.onerror = playbackError;
    void audio.play().then(() => {
      if (audioRef.current === audio) setIsPlaying(true);
    }).catch(playbackError);
  };

  useEffect(() => { if (audioRef.current) audioRef.current.volume = previewVolume; }, [previewVolume]);
  useEffect(() => {
    let active = true;
    void listSfxVersions().then((history) => {
      if (active) setVersions((current) => [...new Map([...history, ...current].map((v) => [v.id, v])).values()].sort((a, b) => b.sequence - a.sequence));
    }).catch((error: unknown) => { if (active) setHistoryError(error instanceof Error ? error.message : 'Riwayat gagal dimuat.'); });
    const leave = () => { if (!isEditorRoute(window.location.hash, 'audio', 'sfx')) stopAudio(); };
    window.addEventListener('hashchange', leave);
    return () => { active = false; operation.current?.abort(); window.removeEventListener('hashchange', leave); stopAudio(); };
  }, [stopAudio]);

  const changeRecipe = (patch: Partial<SfxRecipe>) => {
    if (operation.current || !draft.ready) return;
    stopAudio(); setAudioData(null); setIssues([]);
    const next = { ...recipe, ...patch };
    setRecipe(next); draft.queue(next, savedVersionId);
    setStatus('Parameter berubah. Sintesis ulang sebelum menyimpan atau mengekspor.'); setStatusTone('neutral');
  };

  const applyAiSpec = async (next: SfxRecipe, _attribution: string, signal: AbortSignal) => {
    if (operation.current || !ready.current) throw new Error('Editor belum siap. Kandidat tetap tersimpan untuk ditinjau.');
    if (hasBlockingSfxErrors(validateSfxRecipe(next))) throw new Error('Hasil AI gagal validasi audio. Draf sebelumnya dipertahankan.');
    const controller = new AbortController(); operation.current = controller;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    stopAudio(); setWork('synthesizing');
    setStatus('Menyintesis hasil AI…'); setStatusTone('neutral');
    try {
      const result = await synthesizeSfxAsync(next, controller.signal);
      if (controller.signal.aborted) throw new Error('Sintesis dibatalkan. Draf sebelumnya dipertahankan.');
      if (hasBlockingSfxErrors(result.issues)) throw new Error('Hasil audio gagal pemeriksaan. Draf sebelumnya dipertahankan.');
      setRecipe(next); draft.queue(next, savedVersionId);
      setAudioData(result); setIssues(result.issues);
      setStatus('Audio AI disintesis. Putar untuk memeriksa, lalu simpan versi.'); setStatusTone('success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sintesis gagal.'); setStatusTone('error');
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      if (operation.current === controller) { operation.current = null; setWork(null); }
    }
  };

  const run = useCallback(async (kind: Work, action: (signal: AbortSignal, task: CreatorTaskContext) => Promise<void>) => {
    if (operation.current || !ready.current) return;
    const controller = new AbortController(); operation.current = controller;
    stopAudio(); setWork(kind); setStatusTone('neutral');
    setStatus(kind === 'synthesizing' ? 'Menyintesis audio…' : kind === 'opening' ? 'Memeriksa versi tersimpan…' : kind === 'saving' ? 'Menyimpan versi efek suara…' : 'Mengekspor WAV…');
    try {
      const actionName = kind === 'synthesizing' ? 'render' : kind === 'opening' ? 'open' : kind === 'saving' ? 'save' : 'export';
      await runCreatorTask('sfx', actionName, recipe, controller, async (task) => {
        await task.checkpoint(kind === 'synthesizing' ? 'rendering' : kind === 'opening' ? 'opening' : kind === 'saving' ? 'saving' : 'exporting');
        await action(controller.signal, task);
      });
    }
    catch (error) {
      setStatus(controller.signal.aborted ? 'Sintesis dibatalkan.' : error instanceof Error ? error.message : 'Operasi efek suara gagal.');
      setStatusTone(controller.signal.aborted ? 'neutral' : 'error');
    } finally { if (operation.current === controller) { operation.current = null; setWork(null); } }
  }, [stopAudio, recipe]);

  const validate = useCallback(() => {
    const checks = validateSfxRecipe(recipe); setIssues(checks);
    if (!hasBlockingSfxErrors(checks)) return true;
    setStatus('Perbaiki isian sebelum menyimpan atau mengekspor audio.'); setStatusTone('error'); setView('controls');
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLInputElement>('#sfx-controls [aria-invalid="true"]');
      const details = field?.closest('details');
      if (details) details.open = true;
      field?.focus();
    });
    return false;
  }, [recipe]);

  const synthesize = useCallback(async () => {
    if (!validate()) return;
    await run('synthesizing', async (signal) => {
      const result = await synthesizeSfxAsync(recipe, signal);
      if (signal.aborted) return;
      setAudioData(result); setIssues(result.issues);
      setStatus(`Sintesis efek suara "${recipe.name}" selesai.`); setStatusTone('success');
    });
  }, [recipe, run, validate]);

  const save = useCallback(async (exportAfter = false) => {
    if (!validate()) return;
    await run(exportAfter ? 'exporting' : 'saving', async (signal, task) => {
      const result = audioData ?? await synthesizeSfxAsync(recipe, signal);
      if (signal.aborted) return;
      setAudioData(result);
      await task.checkpoint('saving');
      const version = exportAfter && savedVersion ? savedVersion : task.id
        ? await saveSfxVersion(recipe, result.wavBytes, task.id)
        : await saveSfxVersion(recipe, result.wavBytes);
      if (signal.aborted) return;
      setVersions((current) => [version, ...current.filter((v) => v.id !== version.id)].sort((a, b) => b.sequence - a.sequence));
      setBaseline({ ...recipe }); setSavedVersionId(version.id);
      draft.queue(recipe, version.id);
      if (exportAfter) {
        await task.checkpoint('exporting', { versionId: version.id });
        const exported = await exportSfxVersion(version.id);
        await task.checkpoint('exporting', { versionId: version.id, ...exported });
        setStatus(`WAV diekspor: ${exported.relativePath} (${exported.byteLength} byte).`);
      } else setStatus(`Versi ${version.sequence} disimpan.`);
      setStatusTone('success');
    });
  }, [audioData, recipe, run, savedVersion, validate]);

  const openVersion = (id: string, discardConfirmed = false) => {
    if (dirty && !discardConfirmed) { pendingOpen.current = id; replaceDialog.current?.showModal(); return; }
    void run('opening', async (signal) => {
      const loaded = await loadSfxVersion(id);
      if (signal.aborted) return;
      const result = await synthesizeSfxAsync(loaded.version.recipe, signal);
      if (signal.aborted) return;
      if (result.wavBytes.length !== loaded.wavBytes.length || result.wavBytes.some((value, index) => value !== loaded.wavBytes[index])) {
        throw new Error('Resep dan WAV tersimpan tidak cocok. Draf tetap dipertahankan.');
      }
      setRecipe(loaded.version.recipe); setBaseline(loaded.version.recipe); setSavedVersionId(id);
      draft.queue(loaded.version.recipe, id);
      setAudioData(result); setIssues(result.issues);
      setStatus(`Versi ${loaded.version.sequence} dibuka.`); setStatusTone('success');
    });
  };

  const openRef = useRef(openVersion);
  openRef.current = openVersion;
  useEffect(() => {
    const onOpen = (event: Event) => {
      const target = (event as CustomEvent<{ kind: string; id: string }>).detail;
      if (target.kind === 'sfx') openRef.current(target.id);
    };
    const onFlush = (event: Event) => {
      if (operation.current) (event as CustomEvent<Promise<void>[]>).detail.push(Promise.reject(new Error('Operasi efek suara masih berjalan. Tunggu atau batalkan sintesis.')));
    };
    window.addEventListener('forgekit:open-creator-version', onOpen);
    window.addEventListener('forgekit:flush-draft', onFlush);
    return () => {
      window.removeEventListener('forgekit:open-creator-version', onOpen);
      window.removeEventListener('forgekit:flush-draft', onFlush);
    };
  }, []);

  const copyRecipe = async () => {
    if (!validate()) return;
    try { await navigator.clipboard.writeText(JSON.stringify(recipe, null, 2)); setStatus('Resep DSP efek suara disalin ke clipboard.'); setStatusTone('success'); }
    catch { setStatus('Gagal menyalin ke clipboard.'); setStatusTone('error'); }
  };

  useEffect(() => {
    if (status === 'Draf belum disintesis.') return;
    window.dispatchEvent(new CustomEvent('forgekit:activity', { detail: { message: status, tone: statusTone, time: Date.now() } }));
  }, [status, statusTone]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEditorRoute(window.location.hash, 'audio', 'sfx') || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]:not(dialog)')) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void synthesize(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, synthesize]);

  return (
    <div className="gfx-page sfx-page">
      <dialog className="replace-dialog" ref={replaceDialog} aria-labelledby="sfx-replace-title">
        <h2 id="sfx-replace-title">Buang perubahan saat ini?</h2>
        <p>Isian efek suara yang belum disimpan akan digantikan oleh versi yang dipilih.</p>
        <div className="action-row">
          <button
            className="button secondary-button"
            onClick={() => {
              pendingOpen.current = null;
              replaceDialog.current?.close();
            }}
            type="button"
          >
            Pertahankan draf
          </button>
          <button
            className="button primary-button"
            onClick={() => {
              const target = pendingOpen.current;
              pendingOpen.current = null;
              replaceDialog.current?.close();
              if (target) openVersion(target, true);
            }}
            type="button"
          >
            Ganti dengan versi pilihan
          </button>
        </div>
      </dialog>

      <header className="page-header gfx-page-header">
        <div className="gfx-title-row">
          <span className="page-icon">
            <Icon name="wave" />
          </span>
          <div>
            <div className="page-title-line">
              <h1>Generator Efek Suara</h1>
              <span className="creator-type">DSP AUDIO SYNTHESIS</span>
            </div>
            <p className="page-description">
              Sintesis suara retro, laser, koin, ledakan, dan langkah kaki langsung ke format audio WAV.
            </p>
          </div>
        </div>
        <span className={`document-state${savedVersion ? ' is-saved' : ''}`}>
          {savedVersion
            ? `Versi ${savedVersion.sequence} tersimpan`
            : dirty
              ? 'Draf berubah'
              : 'Belum disimpan'}
        </span>
      </header>
      <EditorAiPromptBar<SfxRecipe> kind="sfx" currentSpec={recipe} disabled={busy} onApplySpec={applyAiSpec} />

      <div aria-label="Aksi efek suara" className="editor-toolbar" role="group">
        <div className="editor-section-tabs">
          <span className="editor-tab-active">
            <Icon name="panel" /> Editor
          </span>
          {versions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                document.getElementById('sfx-versions')?.scrollIntoView({ block: 'start' })
              }
            >
              <Icon name="clock" /> Versi{' '}
              <span className="tab-count">{versions.length}</span>
            </button>
          )}
        </div>
        <div className="toolbar-exports">
          <button
            className="button primary-button"
            disabled={busy}
            form="sfx-brief"
            type="submit"
          >
            <Icon name="spark" /> Sintesis
          </button>
          <Button
            className="secondary-button"
            disabled={busy || !audioData}
            onClick={() => void save()}
          >
            <Icon name="save" /> Simpan versi
          </Button>
          <span className="action-separator" />
          <Button
            className="secondary-button"
            disabled={busy || !audioData}
            onClick={copyRecipe}
          >
            Salin Resep
          </Button>
          <Button
            className="secondary-button"
            disabled={busy || !audioData}
            onClick={() => void save(true)}
          >
            <Icon name="download" /> Ekspor WAV
          </Button>
          <Button
            className="secondary-button"
            disabled
            aria-describedby="sfx-apply-reason"
          >
            Terapkan ke Studio
          </Button>
        </div>
        <span id="sfx-apply-reason" className="visually-hidden">Penerapan belum tersedia: efek suara memerlukan upload Sound asset ID dan adapter Studio saat ini hanya inspeksi baca.</span>
      </div>

      <div className="editor-switch" role="group" aria-label="Tampilan editor">
        <button
          aria-controls="sfx-controls"
          aria-pressed={view === 'controls'}
          className="button secondary-button"
          onClick={() => setView('controls')}
          type="button"
        >
          Pengaturan
        </button>
        <button
          aria-controls="sfx-preview"
          aria-pressed={view === 'preview'}
          className="button secondary-button"
          onClick={() => setView('preview')}
          type="button"
        >
          Pratinjau
        </button>
      </div>

      <div className="gfx-workspace sfx-workspace" data-view={view}>
        <SfxPreview
          analysis={audioData?.analysis ?? null}
          durationMs={recipe.durationMs}
          isPlaying={isPlaying}
          name={recipe.name}
          onPlayToggle={handlePlayToggle}
          volume={previewVolume}
          onVolumeChange={setPreviewVolume}
          waveformSvg={waveformSvg}
        />
        <section aria-label="Brief Efek Suara" className="panel inspector" id="sfx-controls">
          <fieldset className="editor-fields sfx-fields" disabled={busy}>
            <SfxForm
              issues={issues}
              onChange={changeRecipe}
              onSynthesize={() => void synthesize()}
              recipe={recipe}
            />
          </fieldset>
        </section>
      </div>

      <div className={`draft-notice${draft.error ? ' status-error' : ''}`} role={draft.error ? 'alert' : 'status'}>
        <span>{draft.notice}</span>
        {draft.error && <Button className="secondary-button" onClick={() => { void draft.retry().catch(() => {}); }}>Coba simpan draf lagi</Button>}
      </div>
      <footer className="status-bar" role="status">
        <Status tone={statusTone}>{status}</Status>
        {work === 'synthesizing' && <Button className="secondary-button" onClick={() => operation.current?.abort()}>Batalkan sintesis</Button>}
        <span className="shortcut-hint">Sintesis: ⌘/Ctrl+Enter · Simpan: ⌘/Ctrl+S</span>
      </footer>

      {historyError && <p className="status status-error" role="alert">{historyError}</p>}
      {versions.length > 0 && (
        <section
          className="panel version-history"
          id="sfx-versions"
          aria-label="Riwayat versi efek suara"
        >
          <h2>Riwayat Versi Efek Suara</h2>
          <div className="version-list">
            {versions.map((ver) => (
              <div key={ver.id} className="version-item">
                <span className="sfx-version-thumb" aria-hidden="true"><Icon name="wave" /></span>
                <div className="version-meta">
                  <strong>Versi {ver.sequence}</strong>
                  <span>
                    {ver.recipe.name} ({ver.recipe.durationMs} ms · {ver.recipe.category})
                  </span>
                </div>
                <Button
                  className="secondary-button"
                  onClick={() => openVersion(ver.id)}
                  disabled={busy}
                >
                  Buka
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
