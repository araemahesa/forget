import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AiProviderProfile, ConnectionProfile } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { ProviderLogo, providerName } from './ProviderLogo';
import { loadProviderUsage, useProviderUsage, type ProviderUsage } from '../../services/providerUsage';

export type UsageViewMode = 'compact' | 'detailed';

interface OrcaUsagePanelProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: AiProviderProfile[];
  connections?: ConnectionProfile[];
  defaultSelectedId?: string;
}

function formatRelativeTime(seconds: number): string {
  if (seconds <= 0) return 'segera';
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return remHours > 0 ? `${days} hari ${remHours} jam` : `${days} hari`;
  }
  if (hours > 0) {
    const remMins = mins % 60;
    return remMins > 0 ? `${hours} jam ${remMins} mnt` : `${hours} jam`;
  }
  return `${Math.max(1, mins)} mnt`;
}

function formatResetDate(timestampSec: number): string {
  const date = new Date(timestampSec * 1000);
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function getOfficialUsageUrl(providerType: string): string {
  switch (providerType) {
    case 'openai':
      return 'https://chatgpt.com/settings/usage';
    case 'anthropic':
    case 'claude':
      return 'https://console.anthropic.com/settings/limits';
    case 'gemini':
    case 'google-gemini':
      return 'https://aistudio.google.com/';
    case 'antigravity':
    case '9router':
      return 'http://127.0.0.1:9090';
    default:
      return 'https://platform.openai.com/usage';
  }
}

export function OrcaUsagePanel({
  isOpen,
  onClose,
  profiles,
  connections = [],
  defaultSelectedId,
}: OrcaUsagePanelProps) {
  const [viewMode, setViewMode] = useState<UsageViewMode>('detailed');
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    defaultSelectedId || profiles[0]?.id || '',
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass onClose inline; reading it through a ref keeps focus from jumping on every re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const usageEntries = useProviderUsage(profiles, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    // Apply the requested account when opening, not after every user selection.
    setSelectedProfileId(defaultSelectedId || profiles[0]?.id || '');
  }, [isOpen, defaultSelectedId]);

  useEffect(() => {
    if (profiles.some((p) => p.id === selectedProfileId)) return;
    if (defaultSelectedId && profiles.some((p) => p.id === defaultSelectedId)) {
      setSelectedProfileId(defaultSelectedId);
    } else setSelectedProfileId(profiles[0]?.id || '');
  }, [defaultSelectedId, profiles, selectedProfileId]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      previousFocus?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled(profiles.map((p) => loadProviderUsage(p, true)));
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];
  const selectedConnection = connections.find((c) => c.id === selectedProfile?.id);
  const selectedUsageEntry = usageEntries.find((u) => u.profile.id === selectedProfile?.id);
  const selectedUsage = selectedUsageEntry?.data;

  const nowSec = Math.floor(Date.now() / 1000);

  return createPortal(
    <div className="orca-usage-overlay" role="dialog" aria-modal="true" aria-label="Penggunaan dan Kuota Provider">
      <div className={`orca-usage-panel view-${viewMode}`} ref={panelRef}>
        {/* Left Column / Master List */}
        <section className="orca-usage-sidebar">
          <header className="orca-usage-header">
            <div className="orca-usage-title-row">
              <h3>Penggunaan akun</h3>
              <span className="orca-usage-scope">Kuota provider</span>
              <button
                type="button"
                className={`orca-refresh-button${isRefreshing ? ' is-spinning' : ''}`}
                onClick={handleRefreshAll}
                title="Perbarui penggunaan kuota sekarang"
                aria-label="Perbarui penggunaan kuota sekarang"
                disabled={isRefreshing}
              >
                <Icon name="refresh" />
              </button>
              <button type="button" className="orca-close-button" onClick={onClose} aria-label="Tutup panel usage"><Icon name="close" /></button>
            </div>
            <div className="orca-view-toggle" role="radiogroup" aria-label="Tampilan usage">
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'detailed'}
                className={`orca-toggle-pill${viewMode === 'detailed' ? ' is-active' : ''}`}
                onClick={() => setViewMode('detailed')}
              >
                Detail
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'compact'}
                className={`orca-toggle-pill${viewMode === 'compact' ? ' is-active' : ''}`}
                onClick={() => setViewMode('compact')}
              >
                Ringkas
              </button>
            </div>
          </header>

          <div className="orca-provider-list" role="listbox" aria-label="Daftar provider dan akun">
            {profiles.length === 0 ? (
              <div className="orca-empty-state">
                <p>Belum ada akun provider yang terhubung.</p>
                <a href="#settings?section=providers" onClick={onClose} className="orca-link">
                  Hubungkan akun di Pengaturan
                </a>
              </div>
            ) : (
              profiles.map((profile) => {
                const connection = connections.find((c) => c.id === profile.id);
                const entry = usageEntries.find((u) => u.profile.id === profile.id);
                const usage = entry?.data;
                const isSelected = profile.id === selectedProfileId;

                const primaryWindow = usage?.windows?.[0];
                const usedPercent = primaryWindow ? Math.round(primaryWindow.usedPercent) : null;
                const resetsAt = primaryWindow?.resetsAt;
                const resetsIn = resetsAt ? formatRelativeTime(resetsAt - nowSec) : '';

                let statusBadge: React.ReactNode = null;
                if (entry?.loading) {
                  statusBadge = <span className="orca-badge loading">Memuat…</span>;
                } else if (usage?.status === 'available' && usedPercent != null) {
                  const isHigh = usedPercent >= 90;
                  statusBadge = (
                    <span className={`orca-badge-usage${isHigh ? ' is-high' : ''}`}>
                      {resetsIn ? `${resetsIn} ` : ''}
                      <strong>{usedPercent}%</strong>
                    </span>
                  );
                } else if (profile.providerType === 'local-llm') {
                  statusBadge = <span className="orca-badge local">Lokal</span>;
                } else if (usage?.message?.includes('401')) {
                  statusBadge = <span className="orca-badge unread">Izin 401</span>;
                } else {
                  statusBadge = <span className="orca-badge muted">Belum ada data</span>;
                }

                const subtitle =
                  connection?.identity?.displayName ||
                  connection?.identity?.email ||
                  profile.name ||
                  providerName(profile.providerType);

                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`orca-provider-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => setSelectedProfileId(profile.id)}
                  >
                    <span className="orca-provider-icon">
                      <ProviderLogo provider={profile.providerType} />
                    </span>
                    <span className="orca-provider-info">
                      <span className="orca-provider-name">
                        {providerName(profile.providerType)}
                        {connection?.authMethod === 'codex_oauth' && ' · Codex'}
                      </span>
                      <span className="orca-provider-sub">{subtitle}</span>
                    </span>
                    <span className="orca-provider-meta">
                      {statusBadge}
                      <Icon name="chevron" />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <footer className="orca-sidebar-footer">
            <a
              href="#settings?section=providers"
              className="orca-footer-link"
              onClick={onClose}
            >
              <span>Kelola Akun…</span>
              <Icon name="chevron" />
            </a>
          </footer>
        </section>

        {/* Right Column / Detail Pane */}
        {viewMode === 'detailed' && (
          <section className="orca-usage-detail" aria-label="Rincian kuota dan limit akun">
            {selectedProfile ? (
              <>
                <header className="orca-detail-header">
                  <div className="orca-detail-title-group">
                    <span className="orca-detail-logo">
                      <ProviderLogo provider={selectedProfile.providerType} />
                    </span>
                    <div>
                      <h4>{providerName(selectedProfile.providerType)}</h4>
                      <span className="orca-update-time">
                        {selectedUsage?.observedAt
                          ? `Diperbarui ${formatRelativeTime(nowSec - selectedUsage.observedAt)} lalu`
                          : selectedUsage?.checkedAt
                            ? `Diperiksa ${formatResetDate(selectedUsage.checkedAt)}`
                            : 'Belum diperbarui'}
                      </span>
                    </div>
                  </div>

                </header>

                <hr className="orca-divider" />

                <div className="orca-detail-body">
                  {selectedUsageEntry?.loading ? (
                    <div className="orca-detail-loading">
                      <Icon name="refresh" />
                      <p>Membaca data kuota dan limit provider…</p>
                    </div>
                  ) : selectedUsage?.status === 'available' && selectedUsage.windows.length > 0 ? (
                    <div className="orca-buckets-list">
                      {selectedUsage.windows.map((window) => {
                        const used = Math.min(100, Math.max(0, window.usedPercent));
                        const resetsIn = window.resetsAt ? formatRelativeTime(window.resetsAt - nowSec) : '';
                        const resetsFull = window.resetsAt ? formatResetDate(window.resetsAt) : '';

                        return (
                          <div className="orca-bucket-item" key={window.id}>
                            <div className="orca-bucket-title">
                              <strong>{window.label}</strong>
                              {window.scope && <small>{window.scope}</small>}
                            </div>
                            <div
                              className="orca-progress-track"
                              role="progressbar"
                              aria-valuenow={Math.round(used)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${window.label}: ${Math.round(used)}% terpakai`}
                            >
                              <div
                                className={`orca-progress-fill${used >= 90 ? ' is-critical' : used >= 75 ? ' is-warn' : ''}`}
                                style={{ width: `${used}%` }}
                              />
                            </div>
                            <div className="orca-bucket-stats">
                              <span className="orca-bucket-used">{Math.round(used)}% terpakai</span>
                              {resetsIn && (
                                <span className="orca-bucket-reset" title={`Reset pada ${resetsFull}`}>
                                  Reset dalam {resetsIn}
                                </span>
                              )}
                              {window.remaining != null && window.limit != null && (
                                <span className="orca-bucket-count">
                                  {window.remaining.toLocaleString('id-ID')} / {window.limit.toLocaleString('id-ID')}{' '}
                                  {window.unit ?? 'tokens'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : selectedProfile.providerType === 'local-llm' ? (
                    <div className="orca-info-banner local">
                      <Icon name="spark" />
                      <div>
                        <strong>Runtime Lokal</strong>
                        <p>Model dijalankan langsung pada mesin lokal atau server jaringan pribadi tanpa batasan kuota akun cloud.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="orca-info-banner notice">
                      <Icon name="gauge" />
                      <div>
                        <strong>Akses Pembacaan Kuota Belum Tersedia</strong>
                        <p>
                          {selectedUsageEntry?.error || selectedUsage?.message ||
                            'Provider belum menyediakan endpoint pembacaan persentase kuota untuk jenis koneksi ini.'}
                        </p>
                        <p className="orca-hint">
                          Kemampuan inferensi AI dan pemilihan model tetap aktif secara normal. Untuk memeriksa sisa kuota langganan, kunjungi portal resmi provider.
                        </p>
                      </div>
                    </div>
                  )}

                  <hr className="orca-divider" />

                  {/* Account Identity Section */}
                  <div className="orca-account-section">
                    <span className="orca-section-label">
                      {providerName(selectedProfile.providerType)} Account
                    </span>
                    <a
                      href="#settings?section=providers"
                      className="orca-account-card"
                      onClick={onClose}
                      title="Buka pengaturan akun"
                    >
                      <div className="orca-account-avatar">
                        {(selectedConnection?.identity?.displayName || selectedProfile.name || 'A')
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="orca-account-meta">
                        <span className="orca-account-email">
                          {selectedConnection?.identity?.email ||
                            selectedConnection?.identity?.displayName ||
                            selectedProfile.name}
                        </span>
                        <span className="orca-account-plan">
                          {selectedUsage?.planType
                            ? `Paket: ${selectedUsage.planType}`
                            : selectedConnection?.connectionMode === 'router'
                              ? 'Gateway 9router'
                              : selectedConnection?.authMethod === 'codex_oauth'
                                ? 'ChatGPT · Codex'
                              : selectedConnection?.authMethod === 'oauth_browser'
                                ? 'Sign in with ChatGPT'
                                : 'API Key'}
                        </span>
                      </div>
                      <Icon name="chevron" />
                    </a>
                  </div>
                </div>

                <footer className="orca-detail-footer">
                  <a
                    href="#settings?section=providers"
                    className="button secondary-button"
                    onClick={onClose}
                  >
                    Kelola Akun
                  </a>
                  <a
                    href={getOfficialUsageUrl(selectedProfile.providerType)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button outline-button"
                  >
                    <Icon name="link" />
                    <span>Buka Halaman Usage Provider</span>
                  </a>
                </footer>
              </>
            ) : (
              <div className="orca-no-selection">Pilih salah satu akun di samping untuk melihat rincian penggunaan.</div>
            )}
          </section>
        )}
      </div>
    </div>, document.body
  );
}
