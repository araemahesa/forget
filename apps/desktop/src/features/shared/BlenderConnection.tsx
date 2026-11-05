import { useEffect, useState } from 'react';
import { call } from '../../services/tauri';
export function BlenderConnection() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const refresh = () => { void call<{ available: boolean }>('blender_status', {}).then(value => setAvailable(value?.available === true)).catch(() => setAvailable(false)); };
  useEffect(refresh, []);
  return <div className="blender-connection"><span>{available === null ? 'Memeriksa Blender…' : available ? 'Blender terdeteksi' : 'Blender belum terdeteksi'}</span><button type="button" className="theme-button" aria-label="Periksa koneksi Blender" onClick={refresh}>Periksa</button></div>;
}
