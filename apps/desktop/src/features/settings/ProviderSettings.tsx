import { getFeatureChoice, selectAccountForFeatures } from '../../services/featureSelection';
import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useRef, useState } from 'react';
import type { ConnectionProfile, RouterProbe } from '@forgekit/contracts';
import { connectionToLegacyProfile, DEFAULT_PROVIDER_CATALOG } from '@forgekit/contracts';
import { GoogleOAuthSetup } from './GoogleOAuthSetup';
import { ConnectedAccountCard } from './ConnectedAccountCard';
import { RouterGatewayCard, RouterGatewayForm } from './RouterGateway';
import { loadProviderUsage, useProviderUsage } from '../../services/providerUsage';
import { Icon } from '../../design-system/Icon';
import { ProviderLogo } from '../shared/ProviderLogo';
import {
  cancelProviderBrowser, connectProviderBrowser, deleteConnectionProfile, probeRouterModels, saveConnectionProfile,
  saveRouterConnection, testConnectionProfile,
} from '../../services/ai';
import { refreshProviders, useConnectionProfiles } from '../../services/providerState';

const endpoints: Record<string, string> = {
  openai: 'https://api.openai.com/v1', claude: 'https://api.anthropic.com/v1',
  anthropic: 'https://api.anthropic.com/v1', 'google-gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai', 'local-llm': 'http://127.0.0.1:11434/v1',
};
const providerHints: Record<string, string> = { openai: 'Login ChatGPT', claude: 'Koneksi API Claude', 'antigravity-9router': 'Gateway 9router', 'google-gemini': 'Login Google' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Koneksi belum dapat diperiksa.';

export function ProviderSettings() {
  const { profiles, routerConnection, loading, error } = useConnectionProfiles();
  const [selectedAccount, setSelectedAccount] = useState(() => getFeatureChoice('model3d'));
  const usageProfiles = profiles.filter((p) => p.enabled && !['revoked', 'identity_only', 'reauth_required'].includes(p.accessState)).map(connectionToLegacyProfile);
  const accountUsage = useProviderUsage(usageProfiles, true);
  const [draft, setDraft] = useState<ConnectionProfile | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [browserLogin, setBrowserLogin] = useState<string | null>(null);
  const login = useRef<string | null>(null);
  useEffect(() => () => { if (login.current) void cancelProviderBrowser(login.current).catch(() => {}); }, []);
  const [routerUrl, setRouterUrl] = useState(routerConnection.baseUrl);
  const [probe, setProbe] = useState<RouterProbe | null>(null);
  const [routerStatus, setRouterStatus] = useState('');
  const [dashboardOpened, setDashboardOpened] = useState(false);
  const lock = useRef(false);
  const workflow = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { setRouterUrl(routerConnection.baseUrl); }, [routerConnection.baseUrl]);
  useEffect(() => { if (draft) workflow.current?.focus(); }, [draft?.id]);

  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setStatus('');
    try { await operation(); } catch (error) { setStatus(message(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  function close() { setDraft(null); setDashboardOpened(false); trigger.current?.focus(); }
  function connect(providerId: string, button: HTMLButtonElement, existing?: ConnectionProfile) {
    trigger.current = button; setStatus(''); setDashboardOpened(false);
    const router = providerId === 'antigravity-9router';
    const id = existing?.id ?? crypto.randomUUID();
    setDraft(existing ? { ...existing } : {
      id, providerId, connectionMode: router ? 'router' : 'direct', credentialOwner: router ? 'router' : 'forgekit',
      routerInstanceId: router ? routerConnection.id : undefined,
      authMethod: router ? 'router_dashboard' : providerId === 'local-llm' ? 'local_runtime' : 'api_key',
      label: `${DEFAULT_PROVIDER_CATALOG.find((p) => p.id === providerId)?.name ?? 'Koneksi'} · Akun ${profiles.filter((p) => p.providerId === providerId).length + 1}`,
      credentialRef: router ? undefined : `provider-${id}`, accessState: 'pending', enabled: true,
      fallbackEligible: 'unknown', priority: profiles.length,
      quotaBucketRefs: [router ? `router:${routerConnection.id}` : `unverified:${providerId}`],
      baseUrl: router ? routerConnection.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1' : endpoints[providerId] ?? '',
      model: '', isDefault: profiles.length === 0, createdAt: String(Date.now()), updatedAt: String(Date.now()),
    });
  }
  function connectInBrowser(providerId: string) {
    if (lock.current) return;
    setDraft(null);
    const sessionId = crypto.randomUUID();
    login.current = sessionId; setBrowserLogin(sessionId);
    void act(async () => {
      setStatus(providerId === 'openai' ? 'Membuka login ChatGPT melalui Codex. Selesaikan login di browser; akun dan usage akan dibaca otomatis ke ForgeKit.' : providerId === 'google-gemini' ? 'Membuka login resmi Google. Selesaikan persetujuan akses Gemini di browser.' : 'Membuka Claude Console resmi. Akses ForgeKit memakai API resmi Claude.');
      try {
        const session = await connectProviderBrowser(providerId, undefined, sessionId);
        await refreshProviders(true);
        setStatus(session.message ?? 'Browser resmi dibuka.');
      } finally { login.current = null; setBrowserLogin(null); }
    });
  }
  async function checkRouter() {
    const result = await probeRouterModels();
    setProbe(result);
    setRouterStatus(`${result.message} Versi: ${result.detectedVersion ?? 'belum terdeteksi'}.`);
    await refreshProviders(true);
  }
  function saveGateway(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('routerSecret') as HTMLInputElement;
    const secret = input.value || undefined; input.value = '';
    void act(async () => {
      await saveRouterConnection({ ...routerConnection, baseUrl: routerUrl, dashboardUrl: undefined, routingOwner: 'router', managementAccess: 'unknown' }, secret);
      await refreshProviders(true); setProbe(null); setRouterStatus('Gateway tersimpan. Login upstream dikelola 9router.');
      if (draft?.connectionMode === 'router') setDraft({ ...draft, baseUrl: routerUrl.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1', model: '' });
    });
  }
  function submitConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const input = event.currentTarget.elements.namedItem('secret') as HTMLInputElement | null;
    const secret = input?.value || undefined;
    if (input) input.value = '';
    const connection = { ...draft };
    void act(async () => {
      await saveConnectionProfile(connection, secret);
      await refreshProviders(true);
      setStatus('Memeriksa akses model dengan respons teks singkat…');
      const result = await testConnectionProfile(connection);
      await refreshProviders(true);
      setStatus(result.ok ? `Akun tersambung. ${result.message} Tools dan media memerlukan pemeriksaan terpisah.` : `Koneksi tersimpan. Akses belum terverifikasi: ${result.message}`);
      if (result.ok) close();
    });
  }
  const routerDraft = draft?.connectionMode === 'router';
  const knownModels = probe?.models.filter((id) => id.startsWith('ag/')) ?? [];


  const openRouterDashboard = () => void act(async () => {
    const session = await connectProviderBrowser('antigravity-9router');
    setDashboardOpened(true); setStatus(session.message ?? 'Selesaikan login di dashboard, lalu kembali dan periksa koneksi.');
  });
  const gatewayForm = (withDashboard: boolean) => <RouterGatewayForm url={routerUrl} onUrlChange={setRouterUrl} busy={busy} status={routerStatus}
    onSave={saveGateway} onCheck={() => void act(checkRouter)} onOpenDashboard={withDashboard ? openRouterDashboard : undefined} />;

  return <section className="settings-section" id="settings-providers" aria-labelledby="providers-heading">
    <div className="section-header"><h2 id="providers-heading">Provider AI</h2><span className="settings-section-caption">Chat & kreasi</span></div>
    {error && <p className="status-error" role="alert">{error}</p>}
    <div className="provider-cards-grid" role="group" aria-label="Katalog Provider">
      {DEFAULT_PROVIDER_CATALOG.map((item) => <div className="provider-card" key={item.id}>
        <div className="provider-card-main"><div className="provider-card-header"><ProviderLogo provider={item.id} /><strong>{item.name}</strong></div>
          <p className="provider-card-desc" title={item.description}>{providerHints[item.id] ?? item.badge}</p>
          {item.riskNotice && <details className="notice-deprecated"><summary>Dukungan terbatas</summary><p>{item.riskNotice}</p><small>Versi gateway: {routerConnection.detectedVersion ?? 'belum diperiksa'}.</small></details>}
        </div>
        <div className="provider-connect-actions"><button type="button" className="button primary-button connect-btn" disabled={busy} onClick={(e) => item.path === 'router' || item.id === 'claude' ? connect(item.id, e.currentTarget) : connectInBrowser(item.id)}><Icon name="link" />{profiles.some((p) => p.providerId === item.id) ? 'Tambah akun' : 'Connect'}</button>
          {item.path === 'direct' && <button type="button" className="provider-advanced-button" disabled={busy} aria-label={`Koneksi API lanjutan untuk ${item.name}`} title="Koneksi API lanjutan" onClick={(e) => connect(item.id, e.currentTarget)}><Icon name="settings" /></button>}</div>
      </div>)}
    </div>
    <div className="other-connections-bar"><span className="settings-section-caption">Provider lain</span><button className="button secondary-button" type="button" disabled={busy} onClick={(e) => connect('openai-compatible', e.currentTarget)}>Tambah koneksi</button></div>

    {draft && <section className="provider-connect-workflow" ref={workflow} tabIndex={-1} aria-labelledby="connect-heading" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); close(); } }}>
      <div className="section-header"><h3 id="connect-heading">Hubungkan {routerDraft ? 'Antigravity · via 9router' : DEFAULT_PROVIDER_CATALOG.find((p) => p.id === draft.providerId)?.name ?? draft.providerId}</h3>
        <button type="button" className="button secondary-button" disabled={busy} onClick={close}>Batalkan</button></div>
      {routerDraft ? <>
        <p>1. Kaitkan gateway. 2. Tambah akun di dashboard 9router. 3. Kembali, periksa katalog, lalu uji model.</p>
        {gatewayForm(true)}
        {dashboardOpened && <p role="status">Dashboard dibuka. Menutup browser tidak membuktikan login atau pembatalan. Tekan Periksa koneksi setelah selesai.</p>}
        <p>Akun dikelola 9router. Identitas upstream belum tersedia. Urutan akun, Add Connection, dan fallback upstream diatur pada dashboard. ForgeKit tidak menjalankan rotasi kedua.</p>
      </> : <p>{['oauth_browser', 'codex_oauth'].includes(draft.authMethod) ? 'Akun ini menggunakan login browser. Token dikelola otomatis oleh ForgeKit.' : `Pengaturan lanjutan · ${draft.providerId === 'local-llm' ? 'runtime lokal' : 'koneksi API'}. Credential disimpan di Keychain perangkat.`}</p>}
      {draft.providerId === 'claude' && <button className="button secondary-button" type="button" disabled={busy} onClick={() => void act(async () => { const result = await connectProviderBrowser('claude'); setStatus(result.message ?? 'Claude Console dibuka.'); })}>Buka Claude Console</button>}
      <form className="provider-modal-form" onSubmit={submitConnection}>
        <label>Nama akun<input value={draft.label} maxLength={100} required disabled={busy} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
        {routerDraft ? <label>Model tersedia<Dropdown value={draft.model} disabled={busy || !probe} required onChange={(e) => setDraft({ ...draft, model: e.target.value })}><option value="">Pilih model dari katalog</option>{knownModels.map((id) => <option key={id} value={id}>{id}</option>)}</Dropdown></label>
          : <label>Model<input value={draft.model} maxLength={200} required disabled={busy} placeholder="ID model yang tersedia pada akun" onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>}
        {!routerDraft && !['oauth_browser', 'codex_oauth'].includes(draft.authMethod) && <label>Kunci API (disimpan di Keychain)<input name="secret" type="password" autoComplete="off" disabled={busy} required={draft.providerId !== 'local-llm' && !profiles.some((p) => p.id === draft.id)} placeholder={profiles.some((p) => p.id === draft.id) ? 'Kosongkan untuk mempertahankan kunci' : ''} /></label>}
        <details><summary>Koneksi lanjutan</summary>
          {!routerDraft && !endpoints[draft.providerId] && <label>Endpoint HTTPS / loopback<input type="url" required value={draft.baseUrl} disabled={busy} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></label>}
          {draft.providerId === 'local-llm' && <label>Endpoint lokal<input type="url" required value={draft.baseUrl} disabled={busy} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></label>}
          {!routerDraft && <label>Kelompok kuota project/organisasi<input required value={draft.quotaBucketRefs[0] ?? ''} maxLength={256} disabled={busy} onChange={(e) => setDraft({ ...draft, quotaBucketRefs: [e.target.value] })} /><small>Gunakan ID sama untuk kuota bersama. Biarkan nilai unverified jika belum diketahui; profil tersebut tidak dianggap mempunyai kapasitas independen.</small></label>}
          <small>{draft.baseUrl} · {routerDraft ? 'Credential upstream milik router' : 'Credential unik per koneksi'}</small>
        </details>
        <small>Uji mengirim teks singkat: maksimum 32 token output dan 30 detik. Biaya mengikuti akun. Katalog tidak membuktikan akses model.</small>
        <button className="button primary-button" disabled={busy || (routerDraft && !knownModels.includes(draft.model))} type="submit">{busy ? 'Memeriksa…' : 'Simpan & Periksa akses'}</button>
      </form>
    </section>}

    {status && <div className="provider-browser-status"><p className="provider-status-message" role="status">{status}</p>{browserLogin && <button type="button" className="button secondary-button" onClick={() => { void cancelProviderBrowser(browserLogin).catch((error) => setStatus(message(error))); }}>Batalkan login</button>}</div>}
    <div className="connected-accounts-section"><div className="section-header"><h3>Akun tersambung</h3><button className="button secondary-button" type="button" disabled={accountUsage.some((entry) => entry.loading) || !usageProfiles.length} onClick={() => usageProfiles.forEach((profile) => void loadProviderUsage(profile, true))}><Icon name="refresh" />Perbarui usage</button></div>
      {loading && <p role="status">Memuat akun…</p>}
      {!loading && !profiles.length && <p>Hubungkan akun untuk mulai menggunakan AI.</p>}
      <div className="accounts-list">{profiles.map((account) => <ConnectedAccountCard key={account.id} account={account} busy={busy}
        selected={selectedAccount === account.id}
        usage={accountUsage.find((item) => item.profile.id === account.id)}
        onUse={() => { selectAccountForFeatures(account.id); setSelectedAccount(account.id); setStatus('Akun dipilih untuk tugas baru.'); }}
        onManage={(button) => connect(account.providerId, button, account)}
        onTest={() => void act(async () => { const result = await testConnectionProfile(account); await refreshProviders(true); setStatus(`${result.ok ? 'Uji koneksi berhasil' : 'Uji gagal'} (${result.latencyMs}ms): ${result.message}`); })}
        onDisconnect={() => void act(async () => { await deleteConnectionProfile(account.id); await refreshProviders(true); setStatus(`Koneksi ${account.label} dilepas. Riwayat dan akun upstream tetap tersedia.`); })} />)}</div>
    </div>

    <RouterGatewayCard connection={routerConnection} probe={probe} accounts={profiles.filter((p) => p.connectionMode === 'router').length}>
      {routerDraft ? <p className="router-gateway-status">Konfigurasi gateway sedang dibuka pada form Hubungkan Antigravity di atas.</p> : gatewayForm(true)}
    </RouterGatewayCard>
    <details className="advanced-disclosure"><summary>Pengaturan lanjutan</summary><div className="advanced-body"><GoogleOAuthSetup /><p>Keychain macOS menyimpan credential per koneksi. Login Discord, provider AI, dan map Studio terpisah.</p></div></details>
  </section>;
}
