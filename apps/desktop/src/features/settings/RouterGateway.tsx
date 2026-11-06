import type { RouterConnection, RouterProbe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { ProviderLogo } from '../shared/ProviderLogo';

/** URL + key form for the 9router gateway. Reused by the gateway card and the Antigravity connect flow. */
export function RouterGatewayForm({ url, onUrlChange, busy, status, onSave, onCheck, onOpenDashboard }: {
  url: string;
  onUrlChange: (value: string) => void;
  busy: boolean;
  status: string;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onCheck: () => void;
  onOpenDashboard?: () => void;
}) {
  return <form className="provider-modal-form router-gateway-form" onSubmit={onSave}>
    <div className="router-gateway-fields">
      <label>URL 9router<input type="url" value={url} onChange={(e) => onUrlChange(e.target.value)} required disabled={busy} placeholder="http://127.0.0.1:20128" /></label>
      <label>Kunci inference router (bila diwajibkan)<input name="routerSecret" type="password" autoComplete="off" disabled={busy} placeholder="Kosongkan bila tidak dipakai" /></label>
    </div>
    <small className="router-gateway-hint">Credential ini milik gateway. Token login Antigravity tetap di 9router. Server remote menerima konteks tugas; gunakan HTTPS.</small>
    <div className="action-row">
      <button className="button primary-button" disabled={busy} type="submit"><Icon name="link" />Kaitkan router</button>
      <button className="button secondary-button" disabled={busy} type="button" onClick={onCheck}><Icon name="refresh" />Periksa koneksi</button>
      {onOpenDashboard && <button className="button secondary-button" disabled={busy} type="button" onClick={onOpenDashboard}>Buka 9router di Browser</button>}
    </div>
    {status && <p className="router-gateway-status" role="status">{status}</p>}
  </form>;
}

export function RouterGatewayCard({ connection, probe, accounts, children }: {
  connection: RouterConnection;
  probe: RouterProbe | null;
  accounts: number;
  children?: React.ReactNode;
}) {
  const version = probe?.detectedVersion ?? connection.detectedVersion;
  const verified = Boolean(probe?.models.length || connection.lastVerifiedAt);
  const models = probe?.models.filter((id) => id.startsWith('ag/')) ?? [];
  const steps = [
    { title: 'Kaitkan gateway', detail: 'Isi URL 9router lalu simpan.', done: Boolean(connection.baseUrl) },
    { title: 'Tambah akun upstream', detail: 'Login Antigravity di dashboard 9router.', done: accounts > 0 },
    { title: 'Periksa katalog', detail: 'Periksa koneksi untuk membaca model.', done: verified },
  ];
  return <section className="router-gateway-card" aria-labelledby="router-gateway-heading">
    <header className="router-gateway-header">
      <ProviderLogo provider="9router" />
      <div className="router-gateway-title"><h3 id="router-gateway-heading">Gateway 9router</h3><span>Akun Antigravity melalui gateway lokal atau remote</span></div>
      <span className={`router-gateway-pill${verified ? ' is-ok' : ''}`}>{verified ? `Terhubung${version ? ` · v${version}` : ''}` : 'Belum diperiksa'}</span>
    </header>
    <dl className="router-gateway-meta">
      <div><dt>Endpoint</dt><dd>{connection.baseUrl || '—'}</dd></div>
      <div><dt>Akun via router</dt><dd>{accounts}</dd></div>
      <div><dt>Model terbaca</dt><dd>{probe ? `${models.length} Antigravity · ${probe.models.length} total` : '—'}</dd></div>
    </dl>
    <ol className="router-gateway-steps">
      {steps.map((step, index) => <li key={step.title} className={step.done ? 'is-done' : ''}>
        <span className="router-gateway-step-index" aria-hidden="true">{step.done ? <Icon name="check" /> : index + 1}</span>
        <span><strong>{step.title}</strong><small>{step.detail}</small></span>
      </li>)}
    </ol>
    {children}
    <details className="router-gateway-notes"><summary>Akun dan kuota</summary>
      <p>Pilih akun lain pada composer untuk tugas baru. Tugas berjalan tetap memakai akun semula. Kunci API dalam project yang sama dapat berbagi kuota.</p>
      <p>Kuota upstream dibaca melalui API dashboard jika akses tersedia. Kelola akun dan izin dashboard melalui 9router. Putuskan dari ForgeKit hanya melepas profil lokal.</p>
    </details>
  </section>;
}
