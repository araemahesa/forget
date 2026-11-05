import { useRef, useState } from 'react';
import { configureDiscord, loginDiscord, logoutDiscord, useDiscordAccount } from '../../services/accountState';
import { cancelProviderBrowser } from '../../services/ai';
import { MessageAvatar } from '../shared/MessageAvatar';
import { Icon } from '../../design-system/Icon';
export function AccountSettings() {
  const { account, error } = useDiscordAccount();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState('');
  async function act(operation: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setNotice('');
    try { await operation(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Login belum dapat diselesaikan.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="settings-section account-settings" id="settings-account" aria-labelledby="account-heading"><h2 id="account-heading" tabIndex={-1}>Akun Discord</h2>
    <div className="account-profile"><MessageAvatar user profile={account.profile} /><div><strong>{account.profile?.displayName ?? 'Profil percakapan'}</strong><p>{account.profile ? `@${account.profile.username}` : 'Belum tersambung'}</p></div></div>
    <div className="action-row">{account.profile ? <button className="button secondary-button" disabled={busy} onClick={() => void act(async () => { await logoutDiscord(); setNotice('Profil dan credential Discord di perangkat ini telah dilepas. Persetujuan akses dapat dicabut pada Discord → Authorized Apps.'); })}>Keluar dari Discord</button> : <button className="button secondary-button" disabled={busy || !account.clientId} onClick={() => void act(async () => { setNotice('Selesaikan login dan izinkan akses profil di browser Discord.'); await loginDiscord(); setNotice('Discord tersambung. Nama dan avatar siap digunakan di chat.'); })}><Icon name="account" />{busy ? 'Menunggu Discord…' : 'Lanjutkan dengan Discord'}</button>}
    {busy && <button className="button secondary-button" onClick={() => void cancelProviderBrowser('discord-login')}>Batalkan login</button>}</div>
    {(notice || error) && <p role="status" className="account-notice">{notice || error}</p>}
    <details className="oauth-setup"><summary>Konfigurasi Discord{!account.clientId ? ' · diperlukan' : ''}</summary><p>Daftarkan public client dengan PKCE dan callback <code>{account.redirectUri}</code>. Izin: <code>identify</code>.</p><form className="provider-modal-form" onSubmit={(event) => { event.preventDefault(); const id = (event.currentTarget.elements.namedItem('clientId') as HTMLInputElement).value.trim(); void act(async () => { await configureDiscord(id); setNotice('Konfigurasi tersimpan. Discord siap dihubungkan.'); }); }}><label>Application ID<input name="clientId" defaultValue={account.clientId ?? ''} required inputMode="numeric" pattern="[0-9]{17,22}" disabled={busy || !!account.profile} placeholder="Application ID ForgeKit" /></label><button className="button secondary-button" disabled={busy || !!account.profile}>Simpan konfigurasi</button></form></details>
  </section>;
}
