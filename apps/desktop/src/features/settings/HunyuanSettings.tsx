import { useEffect, useState, type FormEvent } from 'react';
import { call } from '../../services/tauri';
import type { HunyuanConfig } from '../model3d/hunyuanPreview';

const failure = (error: unknown) => error instanceof Error ? error.message : 'Operasi worker gagal.';

/** Endpoint and access token for the remote Hunyuan3D GPU worker used by "Buat 3D". */
export function HunyuanSettings() {
  const [config, setConfig] = useState<HunyuanConfig | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    void call<HunyuanConfig>('hunyuan_load_config', {})
      .then((value) => { setConfig(value); setEndpoint(value.endpoint); })
      .catch((e: unknown) => setError(failure(e)));
  }, []);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(failure(e)); } finally { setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const saved = await call<HunyuanConfig>('hunyuan_save_config', { endpoint: endpoint.trim(), token: token.trim() || null });
      setConfig(saved); setToken('');
      setStatus(saved.configured ? 'Koneksi worker tersimpan.' : 'Endpoint tersimpan; isi token agar worker dapat dipakai.');
    });
  }
  const check = () => void act(async () => {
    const health = await call<{ ready: boolean; cuda_available: boolean }>('hunyuan_health', {});
    setStatus(health.ready ? `Worker siap${health.cuda_available ? ' · GPU CUDA aktif' : ' · tanpa CUDA'}.` : 'Worker terhubung tetapi model belum siap.');
  });

  return <section className="settings-section" id="settings-hunyuan" aria-labelledby="hunyuan-heading">
    <h2 id="hunyuan-heading" tabIndex={-1}>Worker GPU Hunyuan</h2>
    <p>Dipakai tombol "Buat 3D dengan Hunyuan" di Model 3D. Endpoint harus HTTPS, atau HTTP ke localhost melalui tunnel SSH. Token disimpan privat di perangkat ini dan tidak dikirim ke endpoint lain.</p>
    {error && <p role="alert" className="status-error">{error}</p>}
    {status && <p role="status">{status}</p>}
    <form className="provider-modal-form" onSubmit={save} aria-label="Koneksi worker Hunyuan">
      <label>Endpoint worker<input type="url" required value={endpoint} disabled={busy || !config} onChange={(e) => setEndpoint(e.target.value)} /></label>
      <label>Token akses<input type="password" autoComplete="off" value={token} disabled={busy || !config} minLength={32} maxLength={256}
        placeholder={config?.hasToken ? 'Kosongkan untuk mempertahankan token tersimpan' : '32–256 karakter'} onChange={(e) => setToken(e.target.value)} /></label>
      <div className="action-row">
        <button className="button primary-button" type="submit" disabled={busy || !config}>{busy ? 'Memproses...' : 'Simpan koneksi'}</button>
        <button className="button secondary-button" type="button" disabled={busy || !config?.configured} onClick={check}>Tes koneksi</button>
      </div>
    </form>
  </section>;
}
