import { Icon, type IconName } from '../../design-system/Icon';
import { type useAppearance, type ThemePreference } from '../../app/useAppearance';

const themes: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'Sistem', icon: 'panel' },
  { value: 'dark', label: 'Gelap', icon: 'moon' },
  { value: 'light', label: 'Terang', icon: 'sun' },
];

export function Appearance({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  return <section className="settings-section" id="settings-appearance" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading" tabIndex={-1}>Tampilan</h2>
    <div className="theme-options" role="group" aria-label="Tema aplikasi">
      {themes.map(({ value, label, icon }) => <button type="button" key={value} className={`theme-option${appearance.preference === value ? ' selected' : ''}`} aria-pressed={appearance.preference === value} onClick={() => appearance.setPreference(value)}>
        <div className={`theme-mini ${value}`} aria-hidden="true"><span /><div><i /><i /><i /></div></div>
        <span><Icon name={icon} />{label}{appearance.preference === value && <Icon name="check" />}</span>
      </button>)}
    </div>
    <div className="setting-row appearance-row">
      <span id="density-label"><strong>Kepadatan</strong></span>
      <div className="segmented-control" role="group" aria-labelledby="density-label">
        <button type="button" aria-pressed={appearance.density === 'comfortable'} onClick={() => appearance.setDensity('comfortable')}>Nyaman</button>
        <button type="button" aria-pressed={appearance.density === 'compact'} onClick={() => appearance.setDensity('compact')}>Ringkas</button>
      </div>
    </div>
    <label className="setting-row motion-setting">
      <span><strong>Kurangi animasi tambahan</strong></span>
      <input type="checkbox" checked={appearance.reduceMotion} onChange={(event) => appearance.setReduceMotion(event.target.checked)} />
    </label>
  </section>;
}
