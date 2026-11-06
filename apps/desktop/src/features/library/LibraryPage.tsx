import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../design-system/Icon';
import { Button } from '../../design-system/Button';
import { creatorLabels, listLibrary, setLibraryDeleted, type LibraryEntry, type LibraryKind } from '../../services/creatorWorkspace';
import { exportGfxArtifact, loadGfxVersion } from '../../services/tauri';
import { exportImageArtifact, loadImageVersion } from '../../services/images';
import { exportSfxVersion, loadSfxVersion } from '../../services/sfx';
import { renderGfxSvg } from '../../engines/gfx/render';
import { renderWaveformSvg } from '../../engines/sfx/dsp';
import { runCreatorTask } from '../../services/creatorTasks';

const icons: Record<LibraryKind, IconName> = { gfx: 'image', sfx: 'wave', icon: 'grid', texture: 'layers', clothing: 'shirt' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Operasi koleksi gagal.';

async function readEntry(entry: LibraryEntry) {
  if (entry.kind === 'gfx') {
    const version = await loadGfxVersion(entry.id);
    if (!version.artifact) throw new Error('Artefak versi tidak tersedia.');
    return { preview: renderGfxSvg(version.spec).svg, spec: version.spec, artifacts: [
      { name: 'gfx', format: 'png', sha256: version.artifact.pngSha256, byteLength: version.artifact.pngByteLength },
      { name: 'gfx', format: 'svg', sha256: version.artifact.sha256, byteLength: version.artifact.byteLength },
    ] };
  }
  if (entry.kind === 'sfx') {
    const loaded = await loadSfxVersion(entry.id);
    const wav = new DataView(new Uint8Array(loaded.wavBytes).buffer);
    const peaks = Array.from({ length: 64 }, () => ({ min: 0, max: 0 }));
    const samples = (wav.byteLength - 44) / 2;
    for (let index = 0; index < samples; index++) {
      const bin = Math.min(63, Math.floor(index * 64 / samples));
      const sample = wav.getInt16(44 + index * 2, true) / 32768;
      peaks[bin].min = Math.min(peaks[bin].min, sample);
      peaks[bin].max = Math.max(peaks[bin].max, sample);
    }
    return { preview: renderWaveformSvg(peaks, 480, 120), spec: loaded.version.recipe,
      artifacts: [{ name: 'audio', format: 'wav', sha256: loaded.version.sha256, byteLength: loaded.version.byteLength }] };
  }
  const loaded = await loadImageVersion(entry.id);
  return { preview: Object.values(loaded.svgs)[0] ?? '', artifacts: loaded.version.artifacts, spec: loaded.version.document.spec };
}

function LibraryThumbnail({ entry }: { entry: LibraryEntry }) {
  const root = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => {
      void readEntry(entry).then((data) => { if (active) setSvg(data.preview); })
        .catch(() => { if (active) setError(true); });
    };
    if (!root.current) return;
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((item) => item.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: '100px' });
    if (observer) observer.observe(root.current);
    else load();
    return () => { active = false; observer?.disconnect(); };
  }, [entry]);
  return <div className="collection-thumbnail library-type-preview" ref={root}>
    {svg ? <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /> : <Icon name={error ? 'alert' : icons[entry.kind]} />}
    <span>{error ? 'Pratinjau perlu diperiksa' : creatorLabels[entry.kind]}</span>
  </div>;
}

export function LibraryPage({ onOpen }: { onOpen: (id: string, kind: LibraryKind) => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<LibraryKind | 'all'>('all');
  const [deleted, setDeleted] = useState(false);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<LibraryEntry | null>(null);
  const [preview, setPreview] = useState('');
  const [artifacts, setArtifacts] = useState<{ name: string; format: string; sha256: string; byteLength: number }[]>([]);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [artifactIndex, setArtifactIndex] = useState(0);
  const input = useRef<unknown>(null);
  const busyRef = useRef(false);

  function blockClose(event: Event) {
    (event as CustomEvent<Promise<void>[]>).detail.push(Promise.reject(new Error('Operasi Library masih berjalan. Tunggu sebelum menutup aplikasi atau membuat backup.')));
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      void listLibrary(query, kind, deleted, offset).then((items) => {
        if (active) setEntries(items);
      }).catch((reason: unknown) => { if (active) { setEntries([]); setError(message(reason)); } })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [query, kind, deleted, offset, revision]);

  useEffect(() => {
    let active = true;
    setPreview(''); setArtifacts([]); setDetailError(''); setArtifactIndex(0);
    if (!selected) return;
    setDetailLoading(true);
    void readEntry(selected).then((data) => {
      if (!active) return;
      input.current = data.spec;
      setPreview(data.preview); setArtifacts(data.artifacts);
    }).catch((reason: unknown) => { if (active) setDetailError(message(reason)); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected]);

  async function changeVisibility(entry: LibraryEntry) {
    if (busyRef.current) return;
    busyRef.current = true;
    window.addEventListener('forgekit:flush-draft', blockClose);
    setBusy(true); setNotice('');
    try {
      await setLibraryDeleted(entry.kind, entry.id, !deleted);
      setSelected(null); setRevision((value) => value + 1);
      setNotice(deleted ? 'Versi dipulihkan ke koleksi.' : 'Versi dipindahkan ke Sampah. Berkas tetap tersimpan dan dapat dipulihkan.');
    } catch (reason) { setNotice(message(reason)); }
    finally { window.removeEventListener('forgekit:flush-draft', blockClose); busyRef.current = false; setBusy(false); }
  }

  async function exportSelected() {
    if (!selected || !artifacts[artifactIndex] || busyRef.current) return;
    busyRef.current = true;
    window.addEventListener('forgekit:flush-draft', blockClose);
    setBusy(true); setNotice('');
    const file = artifacts[artifactIndex];
    try {
      const exportFile = async () => selected.kind === 'gfx'
          ? exportGfxArtifact(selected.id, file.format as 'svg' | 'png')
          : selected.kind === 'sfx' ? exportSfxVersion(selected.id)
            : exportImageArtifact(selected.id, file.name, file.format as 'svg' | 'png');
      const exported = selected.kind === 'gfx' ? await exportFile()
        : await runCreatorTask(selected.kind, 'export', input.current, new AbortController(), async (task) => {
          await task.checkpoint('exporting', { versionId: selected.id });
          const receipt = await exportFile();
          await task.checkpoint('exporting', receipt);
          return receipt;
        });
      setNotice(`Diekspor: ${exported.relativePath} (${exported.byteLength} byte).`);
    } catch (reason) { setNotice(message(reason)); }
    finally { window.removeEventListener('forgekit:flush-draft', blockClose); busyRef.current = false; setBusy(false); }
  }

  return <section className="catalog-page library-page">
    <header className="catalog-heading"><p className="eyebrow">PERSONAL LIBRARY</p><h1>Setiap ide, punya tempat.</h1><p>Versi GFX, efek suara, ikon, tekstur, dan pakaian dari workspace perangkat ini.</p></header>
    <div className="catalog-filter-row library-filters">
      <label className="catalog-search"><Icon name="search" /><input aria-label="Cari koleksi" placeholder="Cari nama karya..." value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); setSelected(null); }} /></label>
      <label>Jenis<Dropdown value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setOffset(0); setSelected(null); }}><option value="all">Semua jenis</option>{Object.entries(creatorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Dropdown></label>
      <div role="group" aria-label="Visibilitas koleksi" className="category-filters">{[false, true].map((trash) => <button key={String(trash)} type="button" aria-pressed={deleted === trash} onClick={() => { setDeleted(trash); setOffset(0); setSelected(null); }}>{trash ? 'Sampah' : 'Koleksi'}</button>)}</div>
      <Button className="secondary-button" onClick={() => setRevision((value) => value + 1)}>Muat ulang</Button>
    </div>
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    <div className="library-layout">
      <div>
        {loading ? <p role="status">Membuka koleksi...</p> : error ? <p className="status-error" role="alert">{error}</p> : entries.length ? <div className="collection-grid">{entries.map((entry) => <button className="collection-card" type="button" key={`${entry.kind}-${entry.id}`} aria-pressed={selected?.id === entry.id} onClick={() => setSelected(entry)}>
          <LibraryThumbnail entry={entry} />
          <div><h2>{entry.name}</h2><p>Versi {entry.sequence} · {new Date(Number(entry.createdAt)).toLocaleDateString('id-ID')}</p></div><Icon name="arrow" />
        </button>)}</div> : <div className="empty-page"><div className="empty-glyph"><Icon name="library" /></div><h2>{deleted ? 'Sampah kosong.' : query || kind !== 'all' ? 'Tidak ada karya yang cocok.' : 'Mulai koleksi pertamamu.'}</h2><p>{deleted ? 'Versi yang dipindahkan ke sini dapat dipulihkan.' : 'Simpan versi dari kreator untuk menambah koleksi.'}</p>{!deleted && <a className="button primary-button" href="#create">Buka kreator</a>}</div>}
        <div className="action-row library-pagination"><Button className="secondary-button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Sebelumnya</Button><span>Halaman {offset / 50 + 1} · Terbaru dahulu</span><Button className="secondary-button" disabled={loading || entries.length < 50} onClick={() => setOffset((value) => value + 50)}>Berikutnya</Button></div>
      </div>
      {selected && <aside className="panel library-detail" aria-label="Detail versi">
        <div className="catalog-filter-row"><h2>{selected.name}</h2><Button className="secondary-button" aria-label="Tutup detail versi" onClick={() => setSelected(null)}><Icon name="close" /></Button></div>
        <p>{creatorLabels[selected.kind]} · Versi {selected.sequence}</p>
        {detailLoading ? <p role="status">Memeriksa artefak...</p> : detailError ? <p className="status-error" role="alert">{detailError}</p> : <>
          {preview && <img className="library-preview" alt={`Pratinjau ${selected.name}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`} />}
          <p>{artifacts.length} artefak terverifikasi. Pilih versi lain untuk membandingkan hasil.</p>
          <label>Artefak<Dropdown value={artifactIndex} onChange={(event) => setArtifactIndex(Number(event.target.value))}>{artifacts.map((file, index) => <option key={`${file.name}-${file.format}`} value={index}>{file.name}.{file.format} · {file.byteLength} byte</option>)}</Dropdown></label>
          {artifacts[artifactIndex] && <details><summary>Integritas SHA256</summary><code className="library-checksum">{artifacts[artifactIndex].sha256}</code></details>}
        </>}
        <div className="library-detail-actions">
          {!deleted && <Button className="primary-button" disabled={busy || detailLoading || !!detailError} onClick={() => onOpen(selected.id, selected.kind)}>Buka di editor</Button>}
          {!deleted && <Button className="secondary-button" disabled={busy || detailLoading || !!detailError} onClick={() => void exportSelected()}>Ekspor artefak</Button>}
          <Button className="secondary-button" disabled={busy} onClick={() => void changeVisibility(selected)}>{deleted ? 'Pulihkan versi' : 'Pindahkan ke Sampah'}</Button>
        </div>
        <p className="image-history-note">Sampah hanya menyembunyikan versi dari Library. Riwayat editor, referensi draft, dan berkas asli tetap tersedia.</p>
      </aside>}
    </div>
  </section>;
}
