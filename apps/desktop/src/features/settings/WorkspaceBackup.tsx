import { useEffect, useState } from 'react';
import { Button } from '../../design-system/Button';
import { Status } from '../../design-system/Status';
import { createWorkspaceBackup, listWorkspaceBackups, restoreWorkspaceBackup, verifyWorkspaceBackup, type BackupInfo } from '../../services/tauri';
import { flushPendingDraft } from '../gfx/useGfxDraft';

export function WorkspaceBackup() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    listWorkspaceBackups().then((rows) => { if (!disposed) setBackups(rows); }).catch((failure: unknown) => {
      if (!disposed) { setError(true); setNotice(failure instanceof Error ? failure.message : 'Daftar backup gagal dimuat.'); }
    });
    return () => { disposed = true; };
  }, []);

  async function run(operation: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError(false); setNotice('Memproses backup lokal...');
    try {
      const result = await operation();
      setBackups(await listWorkspaceBackups());
      setNotice(result);
    } catch (failure) {
      setError(true);
      setNotice(failure instanceof Error ? failure.message : 'Operasi backup gagal.');
    } finally { setBusy(false); }
  }

  return <section className="settings-section" aria-labelledby="backup-heading">
    <h2 id="backup-heading">Backup & pemulihan</h2>
    <p>Salinan database, draf, dan artefak tersimpan. Cache dan ekspor tidak disertakan. Simpan folder backup ke disk lain untuk melindungi karya dari kerusakan disk.</p>
    <Button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
      await flushPendingDraft();
      const backup = await createWorkspaceBackup();
      return `Backup dibuat: ${backup.directory}`;
    })}>Buat backup workspace</Button>
    {notice ? <Status tone={error ? 'error' : 'neutral'}>{notice}</Status> : null}
    {backups.length ? <ul className="backup-list">{backups.map((backup) => <li key={backup.id}>
      <div><strong>{new Date(Number(backup.createdAt)).toLocaleString('id-ID')}</strong>
        <p>{backup.artifactCount} artefak · {new Intl.NumberFormat('id-ID').format(backup.byteLength)} byte</p>
        <p className="workspace-path">{backup.directory}</p></div>
      <div className="action-row">
        <Button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          await verifyWorkspaceBackup(backup.id);
          return 'Backup terverifikasi: integritas database, referensi, ukuran, dan hash artefak cocok.';
        })}>Verifikasi backup</Button>
        <Button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          const directory = await restoreWorkspaceBackup(backup.id);
          return `Salinan pemulihan siap: ${directory}. Workspace aktif tetap dipakai; pergantian workspace belum tersedia.`;
        })}>Pulihkan sebagai salinan</Button>
      </div>
    </li>)}</ul> : <p>Belum ada backup yang berhasil dimuat.</p>}
  </section>;
}
