import { useEffect, useState } from 'react';
import { call } from '../../services/tauri';
type Config = { configured: boolean; clientId: string | null; projectId: string | null };
export function GoogleOAuthSetup() {
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => { let active = true; void call<Config>('get_google_oauth_config', {}).then((value) => { if (active && value) setConfig(value); }).catch(() => {}); return () => { active = false; }; }, []);
  return <details className="oauth-setup"><summary>Konfigurasi OAuth resmi Google / Gemini{config?.configured ? ' · tersedia' : ''}</summary><p>Pengembang mendaftarkan OAuth client bertipe <strong>Desktop app</strong> milik ForgeKit pada Google Cloud, mengaktifkan Generative Language API, mengatur consent screen dan pengguna pengujian atau verifikasi publik. Setelah konfigurasi ini, tombol Connect langsung membuka login Google.</p>
    <form className="provider-modal-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim(); const args = { clientId: value('googleClientId'), clientSecret: value('googleClientSecret'), projectId: value('googleProjectId') }; (form.elements.namedItem('googleClientSecret') as HTMLInputElement).value = ''; setBusy(true); setStatus(''); void call<Config>('configure_google_oauth', args).then((config) => { setConfig(config); setStatus('OAuth Google tersimpan. Tekan Connect pada Google / Gemini.'); }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'Konfigurasi gagal.')).finally(() => setBusy(false)); }}>
      <label>Google OAuth Client ID<input name="googleClientId" required disabled={busy} defaultValue={config?.clientId ?? ''} key={config?.clientId} placeholder="…apps.googleusercontent.com" autoComplete="off" /></label>
      <label>Desktop client secret<input name="googleClientSecret" type="password" required disabled={busy} autoComplete="off" /></label>
      <label>Google Cloud Project ID<input name="googleProjectId" required disabled={busy} defaultValue={config?.projectId ?? ''} key={config?.projectId} placeholder="forgekit-studio" /></label>
      <small>Konfigurasi dan token disimpan di Keychain. Penggunaan Gemini mengikuti izin dan penagihan project Google Cloud.</small><button className="button secondary-button" disabled={busy}>Simpan OAuth Google</button>
    </form>{status && <p role="status">{status}</p>}
  </details>;
}
