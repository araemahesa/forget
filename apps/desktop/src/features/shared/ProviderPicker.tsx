import { useId } from 'react';
import type { AiProviderProfile, ConnectionProfile } from '@forgekit/contracts';
import { Dropdown } from '../../design-system/Dropdown';
import { ProviderLogo, providerName } from './ProviderLogo';
import { Icon } from '../../design-system/Icon';

export interface ProviderPickerProps {
  profiles: AiProviderProfile[];
  connections?: ConnectionProfile[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  primaryProfile?: AiProviderProfile | ConnectionProfile | null;
  onOpenUsage?: () => void;
  isCustomOverride?: boolean;
}

export function ProviderPicker({
  profiles,
  connections = [],
  value,
  onChange,
  disabled,
  label,
  primaryProfile,
  onOpenUsage,
  isCustomOverride: propIsCustomOverride,
}: ProviderPickerProps) {
  profiles = profiles.filter((p) => p.providerType !== 'local-llm');
  const descriptionId = useId();

  const defaultAccount = primaryProfile
    ? profiles.find((p) => p.id === primaryProfile.id) ?? null
    : profiles.find((p) => p.isDefault) ?? null;

  const isInherited = value === 'inherit';
  const isCustomOverride = propIsCustomOverride ?? (!isInherited && !!value);

  const resolvedProfile = isInherited
    ? defaultAccount
    : profiles.find((p) => p.id === value) ?? null;

  const groupOf = (profile: AiProviderProfile) =>
    connections.find((c) => c.id === profile.id)?.providerId ?? profile.providerType;
  const groups = [...new Set(profiles.map(groupOf))];

  const triggerGroup = resolvedProfile
      ? groupOf(resolvedProfile)
      : '';

  const selectedDescription = resolvedProfile
    ? `${providerName(triggerGroup)} · ${resolvedProfile.name}`
    : 'Pilih provider';

  return (
    <div className="provider-picker-wrapper">
      <span id={descriptionId} hidden>
        {selectedDescription}
      </span>
      <Dropdown
        aria-label={label}
        aria-describedby={descriptionId}
        className={`provider-picker${isCustomOverride ? ' is-custom-override' : ''}`}
        menuClassName="provider-picker-menu"
        menuMinWidth={360}
        value={resolvedProfile?.id ?? value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        navigateGroups
        title={selectedDescription}
        triggerContent={<ProviderLogo provider={triggerGroup} />}
        renderGroup={(group) => (
          <>
            <ProviderLogo provider={group} />
            <span>
              {providerName(group)}
            </span>
          </>
        )}
        renderChoice={(choice) => {
          const connection = connections.find((c) => c.id === choice.value);
          const profile = profiles.find((p) => p.id === choice.value);
          const name = connection?.identity?.displayName ?? profile?.name ?? choice.label;
          const initials = name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => Array.from(part)[0])
            .join('')
            .toLocaleUpperCase();

          return (
            <span className="provider-account">
              <span className="provider-account-identity">
                <span className="provider-account-avatar" aria-hidden="true">
                  {initials}
                </span>
                <span className="provider-account-title">
                  <span className="provider-account-heading">
                    <strong>{name}</strong>
                  </span>
                  <span className="provider-account-subtitle">
                    {(connection?.connectionMode === 'router'
                        ? 'via 9router'
                        : connection?.authMethod === 'oauth_browser' || connection?.authMethod === 'codex_oauth'
                          ? 'Akun terhubung'
                          : 'Koneksi API')}
                  </span>
                  {connection?.identity?.email && connection.identity.email !== name && (
                    <span className="provider-usage-note">{connection.identity.email}</span>
                  )}
                </span>
              </span>

            </span>
          );
        }}
      >
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {profiles
              .filter((p) => groupOf(p) === group)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        ))}

      </Dropdown>

      {onOpenUsage && (
        <button
          type="button"
          className="theme-button provider-usage-toggle-button"
          onClick={onOpenUsage}
          title="Buka panel rincian penggunaan kuota provider"
          aria-label="Buka panel rincian penggunaan kuota provider"
        >
          <Icon name="gauge" />
        </button>
      )}
    </div>
  );
}
