import { useEffect, useRef, useState } from 'react';
import { buildBlenderPreview } from './blenderPreview';
import type { ReferenceImage } from '../../services/references';
import type * as THREE from 'three';
import { call } from '../../services/tauri';
import { disposeGeometry } from '../create/geometry';
import { acquireStudioTask, refreshStudioContext } from '../../services/studioState';
type Bundle = { receipt: { metrics: { blenderVersion: string; triangles: number; vertices: number; parts: number; referenceImagesPacked: number; reconstructions?: { partId: string; views: { view: string; silhouetteIou: number }[]; limitations: string[] }[] }; files: { relativePath: string }[]; referenceReview?: { decision: string; differences: string[]; unseen: string[] } }; mesh: unknown; views: ReferenceImage[]; references: ReferenceImage[] };
export function useBlenderModel(versionId?: string) {
  const [model, setModel] = useState<THREE.Group | null>(null); const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const revision = useRef(0);
  const [importing, setImporting] = useState(false), [notice, setNotice] = useState('');
  const importLock = useRef(false);
  useEffect(() => () => { if (model) disposeGeometry(model); }, [model]);
  async function load(id: string, token: number) {
    const result = await call<Bundle | null>('load_blender_bundle', { versionId: id });
    if (revision.current !== token || !result?.mesh) return;
    const loaded = buildBlenderPreview(result.mesh);
    if (revision.current !== token) { disposeGeometry(loaded); return; }
    setBundle(result); setModel(loaded);
  }
  useEffect(() => {
    const token = ++revision.current; setModel(null); setBundle(null); setError(''); setNotice('');
    if (versionId) void load(versionId, token).catch(e => { if (revision.current === token) setError(e instanceof Error ? e.message : 'Hasil Blender gagal dibaca.'); });
    return () => { revision.current++; };
  }, [versionId]);
  async function build() {
    if (!versionId || busy) return;
    const id = versionId, token = revision.current; setBusy(true); setError('');
    try { await call('build_blender_model', { versionId: id }); await load(id, token); }
    catch (e) { if (revision.current === token) setError(e instanceof Error ? e.message : 'Blender gagal.'); }
    finally { setBusy(false); }
  }
  async function reveal() { if (versionId) try { await call('reveal_blender_model', { versionId }); } catch (e) { setError(e instanceof Error ? e.message : 'Folder gagal dibuka.'); } }
  async function open() { if (versionId) try { await call('open_blender_model', { versionId }); } catch (e) { setError(e instanceof Error ? e.message : 'Blender gagal dibuka.'); } }
  async function stop() { if (versionId) await call('cancel_blender_model', { versionId }).catch(e => setError(e instanceof Error ? e.message : 'Pembatalan gagal.')); }
  async function insert() {
    if (!versionId || !bundle || busy || importLock.current) return;
    const id = versionId, token = revision.current;
    importLock.current = true; setImporting(true); setError(''); setNotice('');
    let release = () => {};
    try {
      const studio = await refreshStudioContext();
      if (!studio?.context) throw new Error('Buka map di Roblox Studio dan tunggu koneksinya.');
      if (revision.current !== token) return;
      release = acquireStudioTask();
      const result = await call<{ modelName: string; reused: boolean }>('insert_blender_model', { versionId: id, studioId: studio.studio.studioId, contextSnapshotId: studio.context.id });
      if (revision.current === token) setNotice(`${result.modelName} ${result.reused ? 'sudah ada' : 'dimasukkan'} di ${studio.studio.name}.`);
    } catch (e) { if (revision.current === token) setError(e instanceof Error ? e.message : 'Model gagal dimasukkan ke Studio.'); }
    finally { release(); importLock.current = false; setImporting(false); }
  }
  return { model, bundle, busy: busy || importing, importing, notice, error, build, reveal, open, stop, insert };
}
