import { Icon } from '../../design-system/Icon';
import type { ProviderUsage } from '../../services/providerUsage';

const sources: Record<ProviderUsage['source'], string> = {
  codex: 'ChatGPT', provider_api: 'ChatGPT', google_monitoring: 'Google Monitoring',
  router_api: '9router', api_headers: 'Respons API', none: 'Provider',
};
export function ProviderUsageDetails({ data, loading, error, compact = false }: { compact?: boolean; data: ProviderUsage | null; loading: boolean; error: string }) {
  const available = data?.status === 'available';
  return <span className={`provider-usage${compact ? ' is-compact' : ''}`} aria-busy={loading}>
    <span className="provider-usage-heading"><Icon name="gauge" /><span>Sisa penggunaan</span>{loading && <span className="provider-usage-note">Memperbarui…</span>}</span>
    {available ? data.windows.map((window) => {
      const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
      const reset = window.resetsAt ? new Date(window.resetsAt * 1000) : null;
      const expired = reset != null && reset.getTime() <= Date.now();
      const sameDay = reset?.toDateString() === new Date().toDateString();
      const resetLabel = sameDay ? reset?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : reset?.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const showScope = window.scope && (!['ChatGPT', 'codex'].includes(window.scope) || window.remaining != null || expired);
      return <span className="provider-usage-window" key={window.id}>
        <span className="provider-usage-row">
          <strong>{window.label === '5 jam' ? '5h' : window.label}</strong>
          <span className={`provider-usage-percent${remaining <= 10 && !expired ? ' is-low' : ''}`} aria-label={expired ? 'Menunggu data terbaru' : `${Number(remaining.toFixed(1))}% tersisa`}>
            {expired ? '—' : `${Number(remaining.toFixed(1))}%`}
          </span>
          {reset ? <time dateTime={reset.toISOString()} title={`Reset ${reset.toLocaleString('id-ID')}${expired ? ' · menunggu data terbaru' : ''}`}>{resetLabel}</time>
            : <span className="provider-usage-reset" title="Provider belum mengirim waktu reset">—</span>}
        </span>
        {showScope && <span className="provider-usage-scope">{window.scope}{window.remaining != null && window.limit != null && !expired ? ` · ${window.remaining.toLocaleString('id-ID')} / ${window.limit.toLocaleString('id-ID')} tersisa` : ''}{expired ? ' · menunggu data terbaru' : ''}</span>}
      </span>;
    }) : <span className="provider-usage-note">{loading ? 'Membaca limit akun…' : error || data?.message || 'Data kuota belum tersedia.'}</span>}
    {compact && available && error && <span className="provider-usage-note">{error}</span>}
    {available && data.message && <span className="provider-usage-note">{data.message}</span>}
    {available && !compact && <span className="provider-usage-note">{sources[data.source]} · data diterima <time dateTime={new Date(data.observedAt! * 1000).toISOString()}>{new Date(data.observedAt! * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>{error ? ` · ${error}` : ''}</span>}
    {data && !compact && <span className="provider-usage-note">Terakhir diperiksa <time dateTime={new Date(data.checkedAt * 1000).toISOString()}>{new Date(data.checkedAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</time></span>}
  </span>;
}
