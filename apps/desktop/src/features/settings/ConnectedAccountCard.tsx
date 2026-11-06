import type { ConnectionProfile } from '@forgekit/contracts';
import { connectionToLegacyProfile } from '@forgekit/contracts';
import { useModelSelection } from '../../services/modelCatalog';
import type { ProviderUsage } from '../../services/providerUsage';
import { ModelControls } from '../shared/ModelControls';
import { ProviderLogo } from '../shared/ProviderLogo';
import { ProviderUsageDetails } from '../shared/ProviderUsageDetails';

export const accessLabels = { pending: 'Akses belum diperiksa', ready: 'Respons teks teruji', identity_only: 'Akses AI belum tersedia', reauth_required: 'Hubungkan ulang', revoked: 'Akses dicabut' };
const unusable = ['revoked', 'identity_only', 'reauth_required'];

function connectionMode(account: ConnectionProfile) {
  return account.connectionMode === 'router' ? 'via 9router' : account.authMethod === 'codex_oauth' ? 'ChatGPT · Codex' : account.authMethod === 'oauth_browser' ? 'Login browser' : 'Koneksi API';
}
function accessDescription(account: ConnectionProfile) {
  if (account.connectionMode === 'router') return 'Otomatis via 9router · Akun upstream tidak diketahui';
  if (account.authMethod === 'codex_oauth') return 'Login dan pembaruan token dikelola Codex dalam profil khusus ForgeKit. Usage dibaca dari akun ini.';
  if (account.authMethod === 'oauth_browser') return `Identitas akun diverifikasi saat login resmi ${account.providerId === 'google-gemini' ? 'Google' : account.providerId === 'claude' ? 'Claude' : 'ChatGPT'}.`;
  return 'Identitas akun belum diverifikasi; nama adalah label lokal.';
}

function AccountModels({ account, disabled }: { account: ConnectionProfile; disabled: boolean }) {
  const selection = useModelSelection(account.enabled && !unusable.includes(account.accessState) ? connectionToLegacyProfile(account) : null);
  return <div className="account-models"><ModelControls selection={selection} disabled={disabled} />{selection.models.length > 0 && <small>{selection.models.length} model tersedia</small>}</div>;
}

export function ConnectedAccountCard({ account, usage, selected, busy, onUse, onManage, onTest, onDisconnect }: {
  account: ConnectionProfile;
  usage?: { data: ProviderUsage | null; loading: boolean; error: string };
  selected: boolean;
  busy: boolean;
  onUse: () => void;
  onManage: (button: HTMLButtonElement) => void;
  onTest: () => void;
  onDisconnect: () => void;
}) {
  const ready = account.accessState === 'ready';
  return <article className={`account-card${selected ? ' is-selected' : ''}`} aria-label={account.identity?.displayName ?? account.label}>
    <header className="account-card-header">
      <ProviderLogo provider={account.providerId} />
      <div className="account-name-block"><strong>{account.identity?.displayName ?? account.label}</strong><span className="account-mode-tag">{connectionMode(account)}</span></div>
      <span className={`account-role-badge${selected ? ' is-selected' : ''}`}>{selected ? 'Dipilih' : 'Tersimpan'}</span>
    </header>
    {!ready && <p className="account-access-state" role="note">{accessLabels[account.accessState]}</p>}
    <div className="account-card-body">
      <div className="account-card-usage">{usage ? <ProviderUsageDetails data={usage.data} loading={usage.loading} error={usage.error} compact /> : <p className="account-card-empty">Aktifkan atau hubungkan ulang akun untuk membaca kuota.</p>}</div>
      <AccountModels account={account} disabled={busy} />
    </div>
    <footer className="account-card-footer">
      <div className="action-row">
        <button className={`button ${selected ? 'secondary-button' : 'primary-button'}`} type="button" disabled={busy || !account.enabled || !ready} aria-pressed={selected} onClick={onUse}>{selected ? 'Dipilih' : 'Pakai akun'}</button>
        <button className="button secondary-button" type="button" disabled={busy} onClick={onTest}>Uji koneksi</button>
        <button className="button secondary-button" type="button" disabled={busy} onClick={(event) => onManage(event.currentTarget)}>Kelola</button>
      </div>
      <button className="button secondary-button account-disconnect" type="button" disabled={busy} onClick={onDisconnect}>Putuskan</button>
    </footer>
    <details className="account-access-details"><summary>Detail akses</summary>
      <dl>
        <dt>Provider</dt><dd>{account.providerId}</dd>
        <dt>Model</dt><dd>{account.model || '—'}</dd>
        <dt>Status</dt><dd>{accessLabels[account.accessState]}</dd>
        <dt>Endpoint</dt><dd>{account.baseUrl}</dd>
      </dl>
      <p>{accessDescription(account)}</p>
      <p>Tools dan media belum dibuktikan oleh uji teks.</p>
    </details>
  </article>;
}
