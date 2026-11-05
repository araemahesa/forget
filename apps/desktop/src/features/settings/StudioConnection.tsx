import { Select } from '../../design-system/Select';
import { selectStudioTarget, useStudioDiscovery, useStudioSnapshot } from '../../services/studioState';

export function StudioConnection() {
  const state = useStudioDiscovery();
  const snapshot = useStudioSnapshot();
  return <section className="settings-section" aria-labelledby="studio-heading">
    <h2 id="studio-heading">Roblox Studio</h2>
    <p>ForgeKit mendeteksi Studio dan map secara otomatis selama aplikasi terbuka.</p>
    <div className="studio-auto-status" role="status">
      <span className={`connection-dot ${snapshot ? 'is-connected' : ''}`} />
      <strong>{snapshot ? snapshot.studio.name || 'Map Studio terhubung' : state.status === 'choose' ? 'Pilih map tujuan' : state.status === 'searching' ? 'Mencari Studio…' : 'Menunggu Roblox Studio'}</strong>
    </div>
    {state.studios.length > 1 && <Select label="Map tujuan" value={snapshot?.studio.studioId ?? ''} onChange={selectStudioTarget} options={[{ value: '', label: 'Pilih map yang akan dikelola' }, ...state.studios.map((studio) => ({ value: studio.studioId, label: studio.name || studio.studioId }))]} />}
    {snapshot && <p>{snapshot.context ? `${snapshot.context.loadedNodes} objek hierarki terbaca` : 'Koneksi live tersedia'} · Diperbarui {new Date(Number(snapshot.checkedAt)).toLocaleTimeString('id-ID')}</p>}
    {!snapshot && <p>Buka map di Roblox Studio. Untuk koneksi pertama, aktifkan <strong>Enable Studio as MCP server</strong> melalui Assistant → Manage MCP Servers. Setelah itu koneksi diperbarui otomatis.</p>}
    {state.error && <details><summary>Detail koneksi</summary><p>{state.error}</p></details>}
    <p>Permintaan menggunakan map tujuan yang tetap selama proses. Tools membaca ulang objek sebelum mengubahnya; hasil operasi dicatat dalam rincian proses.</p>
  </section>;
}
