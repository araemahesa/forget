import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../design-system/Icon';

export function GeneratorEmpty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="generator-empty">
    <div className="generator-empty-art" aria-hidden="true"><Icon name={icon} /><span /><span /></div>
    <p className="eyebrow">PRATINJAU KARYA</p>
    <h2>{title}</h2><p>{children}</p>
  </div>;
}
