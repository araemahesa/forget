import { readableError } from './readableError';
import { Dropdown } from '../../design-system/Dropdown';
import type { useModelSelection } from '../../services/modelCatalog';
import { Icon } from '../../design-system/Icon';
import { ProviderLogo } from './ProviderLogo';
export function ModelControls({ selection, disabled = false }: { selection: ReturnType<typeof useModelSelection>; disabled?: boolean }) {
  if (!selection.account) return null;
  const levels = selection.selected?.reasoningEfforts ?? [];
  const needsAccess = selection.error.includes('[KEYCHAIN_LOCKED]');
  return <div className="ai-model-controls">
    <label><span>Model</span><Dropdown aria-label="Model AI" value={selection.modelId} disabled={disabled || needsAccess || !selection.models.length} onChange={(e) => selection.setModel(e.target.value)}
      triggerContent={<span className="model-choice"><ProviderLogo provider={selection.account.providerType} /><span>{selection.selected?.displayName ?? selection.modelId}</span></span>}
      renderChoice={(choice) => <span className="model-choice"><ProviderLogo provider={selection.account!.providerType} /><span>{choice.label}</span></span>}>
      {(!selection.models.length || !selection.selected) && <option value={selection.modelId}>{selection.loading ? 'Memuat model…' : selection.modelId || 'Model belum tersedia'}</option>}
      {selection.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
    </Dropdown></label>
    <label><span>Penalaran</span><Dropdown aria-label="Tingkat penalaran AI" value={selection.effort} disabled={disabled || needsAccess || !levels.length} title={!levels.length ? 'Provider belum menginformasikan pengaturan penalaran untuk model ini.' : undefined} onChange={(e) => selection.setEffort(e.target.value)}>
      <option value="">Otomatis{selection.selected?.defaultReasoningEffort ? ` · ${selection.selected.defaultReasoningEffort}` : ''}</option>
      {levels.map((level) => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
    </Dropdown></label>
    <button type="button" className={`theme-button model-refresh${selection.loading ? ' is-loading' : ''}`} aria-busy={selection.loading} aria-label="Muat ulang model AI" title={needsAccess ? 'Izinkan akses akun untuk memuat model' : selection.error || 'Muat ulang model dari akun ini'} disabled={disabled || selection.loading} onClick={() => void (needsAccess ? selection.authorize() : selection.refresh())}><Icon name="refresh" /></button>
    {selection.selectionError && <small role="alert">{selection.selectionError}</small>}
    {selection.selected?.toolCalling === 'unsupported' && <small role="status">Model ini tidak mendukung tools. Penyusunan recipe teks tetap tersedia.</small>}
    {selection.error && <small role="status" className={`model-catalog-error${needsAccess ? ' needs-access' : ''}`}>{needsAccess ? 'Akun tersimpan. Izinkan akses macOS untuk memuat dan memakai model.' : `Daftar model belum diperbarui: ${readableError(selection.error)}`} <button type="button" disabled={disabled || selection.loading} onClick={() => void (needsAccess ? selection.authorize() : selection.refresh())}>{needsAccess ? 'Izinkan akses akun' : 'Coba lagi'}</button></small>}
  </div>;
}
