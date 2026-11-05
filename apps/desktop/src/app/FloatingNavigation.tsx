import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../design-system/Icon';
import { creativeFeatures } from './featureRegistry';

export function FloatingNavigation({ route }: { route: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const children = useRef<HTMLDivElement>(null);
  const focusChild = useRef(false);
  const pointerOutside = useRef(false);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => { setOpen(false); }, [route]);
  useLayoutEffect(() => {
    if (open && focusChild.current) {
      focusChild.current = false;
      children.current?.querySelector('a')?.focus();
    }
  }, [open]);
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      pointerOutside.current = !root.current?.contains(event.target as Node);
    };
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
      pointerOutside.current = false;
    };
    const keyboard = () => { pointerOutside.current = false; };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('click', outside);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, []);

  return <nav className={`floating-navigation${open ? ' has-expanded-group' : ''}`} ref={root} aria-label="Navigasi utama"
    onBlur={(event) => {
      // Outside pointer clicks must reach their target before the workspace reflows.
      if (!pointerOutside.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) close();
    }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); close(true); }
    }}>
    <a className="floating-icon" href="#chat" aria-label="AI Chat" title="AI Chat" aria-current={route === 'chat' ? 'page' : undefined} onClick={() => close()}><Icon name="message" /></a>
    <div className="floating-icon-wrap">
      <button className="floating-icon" type="button" ref={trigger} aria-label="Studio Kreatif" title="Studio Kreatif"
        aria-expanded={open} aria-controls="creative-children" data-current={route.startsWith('create/')}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            event.preventDefault();
            if (open) children.current?.querySelector('a')?.focus();
            else { focusChild.current = true; setOpen(true); }
          }
        }}><Icon name="spark" /></button>
      {open && <div className="navigation-children" id="creative-children" role="group" aria-label="Studio Kreatif" ref={children}
        onKeyDown={(event) => {
          const items = Array.from(event.currentTarget.querySelectorAll('a'));
          const current = items.indexOf(document.activeElement as HTMLAnchorElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
              (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[index]?.focus();
          }
          if (event.key === ' ') { event.preventDefault(); items[current]?.click(); }
        }}>
        {creativeFeatures.map((feature) => <a className="navigation-child" key={feature.id} title={feature.label} href={`#${feature.route}`}
          aria-current={route === feature.route ? 'page' : undefined} onClick={() => close(true)}>
          <Icon name={feature.icon} /><span>{feature.label}</span>
        </a>)}
      </div>}
    </div>
    <a className="floating-icon" href="#settings" aria-label="Pengaturan" title="Pengaturan" aria-current={route === 'settings' ? 'page' : undefined} onClick={() => close()}><Icon name="settings" /></a>
  </nav>;
}
