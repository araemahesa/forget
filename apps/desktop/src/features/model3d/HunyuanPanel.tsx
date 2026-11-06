import { useEffect, useRef, useState } from 'react';
import { Group } from 'three';
import { call } from '../../services/tauri';
import { readReference, type ReferenceImage } from '../../services/references';
import { disposeGeometry } from '../create/geometry';
import { ThreeViewport } from '../create/ThreeViewport';
import { ObsidianContext } from '../shared/ObsidianContext';
import { ModelEditChat } from './ModelEditChat';
import { glbBytes, hunyuanJobActive, loadHunyuanPreview, type HunyuanConfig, type HunyuanJob, type HunyuanModel } from './hunyuanPreview';
import './hunyuan.css';

const pendingKey = 'forgekit:hunyuan:pending';
function restorePending() {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey) ?? 'null');
    if (/^[a-f0-9]{32}$/.test(value?.id) && typeof value.endpoint === 'string') return value as { id: string; endpoint: string };
  } catch { /* Invalid UI recovery data never submits a new generation. */ }
  return null;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Operasi Hunyuan gagal.';
const labels = { queued: 'Antrean', running: 'Membuat model', succeeded: 'Model siap di server', failed: 'Gagal', cancelled: 'Dibatalkan' };

export function HunyuanPanel({ active }: { active: boolean }) {
  const [config, setConfig] = useState<HunyuanConfig | null>(null);
  const [image, setImage] = useState<ReferenceImage | null>(null);
  const [seed, setSeed] = useState(0), [steps, setSteps] = useState(30);
  const [job, setJob] = useState<HunyuanJob | null>(null);
  const [pendingId, setPendingId] = useState(() => restorePending()?.id ?? '');
  const [pendingEndpoint, setPendingEndpoint] = useState(() => restorePending()?.endpoint ?? '');
  const [paused, setPaused] = useState(false);
  const [models, setModels] = useState<HunyuanModel[]>([]);
  const [selected, setSelected] = useState<HunyuanModel | null>(null);
  const [object, setObject] = useState<Group | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [empty] = useState(() => new Group());
  const mounted = useRef(true), previewRevision = useRef(0), operation = useRef(false), pollRevision = useRef(0);
  const running = !!pendingId && (!job || hunyuanJobActive(job));

  useEffect(() => {
    mounted.current = true;
    void call<HunyuanConfig>('hunyuan_load_config', {}).then(settings => {
      if (mounted.current) setConfig(settings);
    }).catch(e => { if (mounted.current) setError(message(e)); });
    void call<HunyuanModel[]>('hunyuan_list_models', {}).then(saved => {
      if (mounted.current) setModels(saved);
    }).catch(e => { if (mounted.current) setError(message(e)); });
    return () => { mounted.current = false; previewRevision.current++; };
  }, []);
  useEffect(() => () => { if (object) disposeGeometry(object); }, [object]);
  useEffect(() => {
    if (!pendingId || paused || !config) return;
    if (pendingEndpoint !== config.endpoint) { setError('Endpoint job berbeda dari koneksi tersimpan. Lepaskan pelacakan lokal sebelum memakai worker lain.'); return; }
    let current = true;
    const revision = ++pollRevision.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await call<HunyuanJob>('hunyuan_poll', { id: pendingId });
        if (!current || pollRevision.current !== revision) return;
        setJob(value);
        if (hunyuanJobActive(value)) timer = setTimeout(() => void poll(), 2500);
        else if (value.status !== 'succeeded') { setPendingId(''); localStorage.removeItem(pendingKey); }
      } catch (e) { if (current && pollRevision.current === revision) { setError(message(e)); setPaused(true); } }
    }
    void poll();
    return () => { current = false; clearTimeout(timer); };
  }, [pendingId, pendingEndpoint, paused, config]);

  async function perform(name: string, action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(name); setError(''); setNotice('');
    try { await action(); } catch (e) { if (mounted.current) setError(message(e)); }
    finally { operation.current = false; if (mounted.current) setBusy(''); }
  }
  async function preview(model: HunyuanModel) {
    const revision = ++previewRevision.current;
    const result = await call<{ base64: string }>('hunyuan_load_model', { relativePath: model.relativePath });
    const loaded = await loadHunyuanPreview(result.base64);
    if (!mounted.current || revision !== previewRevision.current) { disposeGeometry(loaded); return; }
    setObject(loaded); setSelected(model);
  }
  async function pick(file?: File) {
    if (!file) return;
    setImage(null);
    await perform('image', async () => {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) throw new Error('Pilih satu gambar PNG, JPEG, atau WebP.');
      const value = await readReference(file);
      if (!value.dataUrl?.startsWith('data:image/png;base64,')) throw new Error('Gambar PNG gagal disiapkan.');
      if (mounted.current) setImage(value);
    });
  }
  async function start() {
    await perform('start', async () => {
      if (!image?.dataUrl) throw new Error('Pilih satu gambar terlebih dahulu.');
      if (!config?.configured) throw new Error('Isi endpoint dan token worker di Pengaturan → Worker GPU Hunyuan terlebih dahulu.');
      if (pendingId) throw new Error('Simpan hasil atau lepaskan job lokal sebelum membuat model baru.');
      const health = await call<{ ready: boolean; cuda_available: boolean }>('hunyuan_health', {});
      if (!health.ready || !health.cuda_available) throw new Error('Worker belum siap. Periksa CUDA dan model di server sebelum mengirim gambar.');
      let value: HunyuanJob;
      try { value = await call<HunyuanJob>('hunyuan_start', { imageBase64: image.dataUrl.split(',')[1], seed, steps, texture: true }); }
      catch (e) { throw new Error(`${message(e)} Permintaan mungkin sudah diterima server.`); }
      setJob(value); setPaused(false);
      if (value.obsidianWarning) setNotice(value.obsidianWarning);
      else if (value.obsidianSnapshot) setNotice('Panduan Obsidian tersimpan lokal untuk pemeriksaan hasil.');
      if (hunyuanJobActive(value) || value.status === 'succeeded') { localStorage.setItem(pendingKey, JSON.stringify({ id: value.id, endpoint: config.endpoint })); setPendingEndpoint(config.endpoint); setPendingId(value.id); }
    });
  }
  async function saveModel() {
    if (!job || job.status !== 'succeeded') return;
    await perform('save', async () => {
      const saved = await call<HunyuanModel>('hunyuan_download', { id: job.id });
      setPendingId(''); localStorage.removeItem(pendingKey);
      setModels(previous => [saved, ...previous.filter(item => item.relativePath !== saved.relativePath)]);
      setNotice(`Model tersimpan.`);
      await preview(saved);
    });
  }
  async function downloadModel() {
    if (!selected) return;
    await perform('download', async () => {
      const result = await call<{ base64: string }>('hunyuan_load_model', { relativePath: selected.relativePath });
      const bytes = glbBytes(result.base64);
      const blob = new Blob([bytes], { type: 'model/gltf-binary' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = `${selected.jobId.slice(0, 8)}.glb`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  }
  return <section className="hunyuan-panel" hidden={!active} aria-label="Panel Hunyuan3D-2">
    <div className="procedural-layout">
      <aside className="generator-inspector" aria-label="Kontrol Hunyuan3D-2">
        <form className="hunyuan-form" onSubmit={event => { event.preventDefault(); void start(); }}>
          <fieldset disabled={!!busy || !!pendingId || running}>
            <div className="hunyuan-section-heading"><label htmlFor="hunyuan-file">Gambar referensi</label><span className="hunyuan-meta">Warna aktif</span></div>
            <input id="hunyuan-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void pick(event.target.files?.[0])} />
            {image?.dataUrl && <figure className="hunyuan-reference"><img src={image.dataUrl} alt={`Referensi: ${image.name}`} /><figcaption>{image.name}</figcaption></figure>}
            <details className="hunyuan-advanced">
              <summary>Pengaturan generasi</summary>
              <div className="hunyuan-generation-options">
              <label htmlFor="hunyuan-seed">Seed</label><input id="hunyuan-seed" name="seed" type="number" required min={0} max={2147483647} step={1} value={seed} onChange={event => setSeed(event.target.valueAsNumber)} />
              <label htmlFor="hunyuan-steps">Langkah inferensi</label><input id="hunyuan-steps" name="steps" type="number" required min={1} max={50} step={1} value={steps} onChange={event => setSteps(event.target.valueAsNumber)} />
              </div>
              <details className="hunyuan-advanced"><summary>Panduan Obsidian</summary><ObsidianContext /></details>
            </details>
            <button className="button primary-button" type="submit" aria-label="Buat 3D dengan Hunyuan">{busy === 'start' ? 'Mengirim gambar…' : 'Buat 3D'}</button>
          </fieldset>
        </form>
        {(job || pendingId) && <section className="model-process" aria-label="Status job Hunyuan">
          <p role="status">{job ? labels[job.status] : 'Memulihkan status job…'}{job?.stage ? ` · ${job.stage}` : ''}</p>
          {job?.error && <p role="alert">{job.error}</p>}
          {running && config?.endpoint === pendingEndpoint && <button className="button secondary-button" type="button" disabled={!!busy} onClick={() => void perform('cancel', async () => { const value = await call<HunyuanJob>('hunyuan_cancel', { id: job?.id ?? pendingId }); pollRevision.current++; setJob(value); if (!hunyuanJobActive(value)) { setPendingId(''); localStorage.removeItem(pendingKey); } })}>Batalkan job</button>}
          {!!pendingId && <button className="button secondary-button" type="button" disabled={!!busy} onClick={() => {
            if (!window.confirm('Lepaskan pelacakan job dari aplikasi ini? Job di server mungkin masih berjalan dan memakai GPU. Tindakan ini tidak membatalkan job. Hasil yang belum disimpan tidak lagi dapat diakses dari panel ini.')) return;
            pollRevision.current++; setPendingId(''); setJob(null); setPaused(false); localStorage.removeItem(pendingKey); setNotice('Pelacakan lokal dilepas.');
          }}>Lepaskan job lokal</button>}
          {paused && <button className="button secondary-button" type="button" disabled={!!busy} onClick={() => { setError(''); setPaused(false); }}>Coba status lagi</button>}
          {job?.status === 'succeeded' && <button className="button" type="button" disabled={!!busy} onClick={() => void saveModel()}>Simpan &amp; pratinjau GLB</button>}
        </section>}
        <ModelEditChat model={selected} disabled={!!busy || running} onBusyChange={working => {
          operation.current = working; setBusy(working ? 'edit' : '');
        }} onEdited={async model => {
          setModels(previous => [model, ...previous.filter(item => item.relativePath !== model.relativePath)]);
          await preview(model);
        }} />
        {error && <p className="generator-error" role="alert">{error}</p>}
        {notice && <p className="generator-caption" role="status">{notice}</p>}
      </aside>
      <div className="procedural-canvas model-blender-canvas">
        <div className="viewport-toolbar"><span>Pratinjau 3D</span></div>
        {active && <ThreeViewport object={object ?? empty} label="Pratinjau GLB Hunyuan3D-2" emptyMessage="Pilih gambar lalu tekan Buat 3D." />}
        <div className="generator-actions">
          <button className="button primary-button" type="button" disabled={!selected || !!busy} onClick={() => void perform('blender', async () => { await call('hunyuan_open_blender', { relativePath: selected!.relativePath }); setNotice('GLB dibuka di Blender.'); })}>Buka di Blender</button>
          <button className="button secondary-button" type="button" disabled={!selected || !!busy} onClick={() => void downloadModel()}>Unduh GLB</button>
          <button className="button secondary-button" type="button" disabled={!selected || !!busy} onClick={() => void perform('folder', async () => { await call('hunyuan_reveal_model', { relativePath: selected!.relativePath }); })}>Buka folder hasil</button>
        </div>
        {selected && <p className="generator-caption hunyuan-path">Model 3D · {(selected.byteLength / 1024 / 1024).toFixed(1)} MiB</p>}
        <section className="model-history" aria-label="GLB Hunyuan tersimpan">
          <h2>Riwayat Model</h2>
          {models.length ? <div className="model-history-list">{models.map(model => <button type="button" key={model.relativePath} disabled={!!busy} aria-pressed={selected?.relativePath === model.relativePath} onClick={() => void perform('preview', () => preview(model))}><span><strong>{model.parentJobId ? 'Revisi AI' : 'Hunyuan'} {model.jobId.slice(0, 8)}</strong><small>{(model.byteLength / 1024 / 1024).toFixed(1)} MiB{model.parentJobId ? ` · dari ${model.parentJobId.slice(0, 8)}` : ''}</small></span></button>)}</div> : <p>Belum ada model tersimpan.</p>}
        </section>
      </div>
    </div>
  </section>;
}
