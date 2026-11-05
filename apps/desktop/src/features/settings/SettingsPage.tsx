import { useEffect, useRef } from 'react';
import type { WorkspacePageProps } from '../../app/featureRegistry';
import { Appearance } from './Appearance';
import { StudioConnection } from './StudioConnection';
import { WorkspaceBackup } from './WorkspaceBackup';
import { ProviderSettings } from './ProviderSettings';
import { AccountSettings } from './AccountSettings';
import { BrandMark } from '../../design-system/BrandMark';
import { version } from '../../../package.json';

export function SettingsPage({ appearance, section }: WorkspacePageProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (section) root.current?.querySelector(`#settings-${section}`)?.scrollIntoView?.({ block: 'start' });
  }, [section]);
  return <section className="catalog-page settings-page">
    <header className="catalog-heading"><h1>Pengaturan</h1><p>Akun, AI, dan tampilan.</p></header>
    <div ref={root} className="settings-content"><div className="settings-preferences"><AccountSettings /><Appearance appearance={appearance} /></div><ProviderSettings />
      <details className="settings-advanced"><summary>Koneksi Studio & penyimpanan</summary><StudioConnection /><WorkspaceBackup /></details>
    </div>
    <div className="settings-about"><BrandMark /><div><strong>ForgeKit Studio</strong></div><span>v{version}</span></div>
  </section>;
}
