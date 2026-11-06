import { useEffect, useState } from 'react';
import { call } from '../../services/tauri';
import { useStudioDiscovery, useStudioSnapshot } from '../../services/studioState';
import { StudioTargetPicker } from '../../app/StudioTargetPicker';

type State = 'ok' | 'waiting' | 'error';
function Row({ name, state, detail, children }: { name: string; state: State; detail: string; children?: React.ReactNode }) {
  return <li className={`connection-row is-${state}`}>
    <span className="connection-dot" aria-hidden="true" />
    <span className="connection-text"><strong>{name}</strong><small>{detail}</small></span>
    {children}
  </li>;
}

/**
 * Roblox Studio and Blender connect by themselves: Studio is polled while ForgeKit runs and the
 * open map is picked automatically; Blender is detected on launch and whenever the window regains
 * focus. Nothing here needs to be filled in.
 */
export function ConnectionStatus() {
  const discovery = useStudioDiscovery();
  const snapshot = useStudioSnapshot();
  const [blender, setBlender] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => { void call<{ available: boolean }>('blender_status', {}).then((v) => { if (alive) setBlender(v?.available === true); }).catch(() => { if (alive) setBlender(false); }); };
    check();
    window.addEventListener('focus', check);
    return () => { alive = false; window.removeEventListener('focus', check); };
  }, []);

  const open = discovery.studios.length;
  const studio: { state: State; detail: string } = snapshot
    ? { state: 'ok', detail: `Tersambung ke "${snapshot.studio.name || 'map tanpa nama'}"${open > 1 ? ` · ${open} map terbuka` : ''}` }
    : discovery.status === 'searching' ? { state: 'waiting', detail: 'Mencari Roblox Studio…' }
    : discovery.status === 'unavailable' ? { state: 'error', detail: discovery.error || 'Studio belum dapat dihubungi. ForgeKit mencoba lagi otomatis.' }
    : open ? { state: 'waiting', detail: 'Studio terbuka; menunggu map siap dibaca…' }
    : { state: 'waiting', detail: 'Buka Roblox Studio dan sebuah place — ForgeKit menyambung sendiri.' };

  return <section className="settings-section connection-status" id="settings-connections" aria-labelledby="connections-heading">
    <h2 id="connections-heading" tabIndex={-1}>Koneksi</h2>
    <p>Roblox Studio dan Blender tersambung otomatis, tanpa pengaturan. Perubahan map dari AI langsung dijalankan dan setiap perubahan tercatat sebagai satu langkah Undo di Studio (⌘Z untuk membatalkan).</p>
    <ul className="connection-list">
      <Row name="Roblox Studio" {...studio}>{open > 1 && <StudioTargetPicker />}</Row>
      <Row name="Blender" state={blender === null ? 'waiting' : blender ? 'ok' : 'error'}
        detail={blender === null ? 'Memeriksa Blender…' : blender ? 'Terdeteksi · dipakai untuk Model 3D' : 'Belum terdeteksi · pasang Blender di folder Applications'} />
    </ul>
  </section>;
}
