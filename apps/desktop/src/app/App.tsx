import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Icon } from '../design-system/Icon';
import { BrandMark } from '../design-system/BrandMark';
import { FloatingNavigation } from './FloatingNavigation';
import { featureRegistry, resolveRoute, routeForVersion, type WorkspaceRoute } from './featureRegistry';
import { useAppearance } from './useAppearance';
import { startStudioDiscovery, useStudioSnapshot } from '../services/studioState';
import { StudioTargetPicker } from './StudioTargetPicker';
import type { LibraryKind } from '../services/creatorWorkspace';

const pages = new Map(featureRegistry.map((feature) => [feature.id, lazy(feature.load)]));
type VersionRequest = { id: string; kind: LibraryKind };
function OpenVersion({ request, onOpened }: { request: VersionRequest | null; onOpened: () => void }) {
  useEffect(() => {
    if (!request) return;
    window.dispatchEvent(request.kind === 'gfx'
      ? new CustomEvent('forgekit:open-version', { detail: request.id })
      : new CustomEvent('forgekit:open-creator-version', { detail: request }));
    onOpened();
  }, [request, onOpened]);
  return null;
}

export function App() {
  const [route, setRoute] = useState(() => resolveRoute(window.location.hash));
  const [visited, setVisited] = useState<Record<string, WorkspaceRoute>>({ [route.feature.id]: route });
  const appearance = useAppearance();
  const studio = useStudioSnapshot();
  useEffect(() => startStudioDiscovery(), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [versionToOpen, setVersionToOpen] = useState<VersionRequest | null>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const paletteTrigger = useRef<HTMLElement | null>(null);
  const paletteDialog = useRef<HTMLDialogElement>(null);
  const changeTheme = () => appearance.setPreference(appearance.theme === 'dark' ? 'light' : 'dark');
  const actions = [
    ...featureRegistry.map((feature) => ({ label: `Buka ${feature.label}`, href: feature.route, icon: feature.icon, run: undefined as (() => void) | undefined })),
    { label: appearance.theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap', href: 'settings?section=appearance', icon: 'sun' as const, run: changeTheme },
  ];
  const filtered = actions.filter(({ label }) => label.toLocaleLowerCase('id').includes(paletteQuery.toLocaleLowerCase('id')));
  const closePalette = () => { paletteDialog.current?.close(); setPaletteOpen(false); paletteTrigger.current?.focus(); };
  const openPalette = () => { paletteTrigger.current = document.activeElement as HTMLElement; setPaletteQuery(''); setPaletteIndex(0); setPaletteOpen(true); };
  function choose(action: typeof actions[number]) { action.run?.(); window.location.hash = action.href; closePalette(); }
  function openVersion(id: string, kind: LibraryKind) { setVersionToOpen({ id, kind }); window.location.hash = routeForVersion(kind); }

  useEffect(() => {
    const update = () => {
      const next = resolveRoute(window.location.hash);
      if (window.location.hash !== `#${next.hash}`) window.history.replaceState(null, '', `#${next.hash}`);
      setRoute(next);
      setVisited((items) => ({ ...items, [next.feature.id]: next }));
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (paletteOpen) { paletteDialog.current?.showModal(); paletteInput.current?.focus(); }
    else paletteDialog.current?.close();
  }, [paletteOpen]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',' && !document.querySelector('dialog[open]')) {
        event.preventDefault(); window.location.hash = 'settings';
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (event.repeat) return;
        if (paletteOpen) closePalette();
        else if (!document.querySelector('dialog[open]')) openPalette();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [paletteOpen]);

  return <div className="app-shell">
    <FloatingNavigation route={route.feature.route} />
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-leading"><a className="topbar-brand" href="#chat" aria-label="ForgeKit Studio"><BrandMark /><span>ForgeKit Studio</span></a>
          <span className="topbar-divider" /><div className="breadcrumb">{studio && <><span>{studio.studio.name || 'Studio'}</span><Icon name="chevron" /></>}<strong>{route.feature.label}</strong></div>
          <span className="studio-status" role="status" aria-label="Status koneksi Roblox Studio" data-connected={!!studio} title={studio?.studio.name || 'Deteksi Studio otomatis'}><Icon name="link" />{studio ? 'Studio terhubung' : 'Studio belum terhubung'}</span><StudioTargetPicker /></div>

      </header>
      <div className={`page-body${route.feature.id === 'chat' ? ' is-chat' : ''}`} id={route.feature.id}>
        {Object.values({ ...visited, [route.feature.id]: route }).map((match) => {
          const Page = pages.get(match.feature.id)!;
          const active = match.feature.id === route.feature.id;
          return <div key={match.feature.id} hidden={!active}>
            <Suspense fallback={active ? <p role="status">Membuka {match.feature.label}...</p> : null}>
              <Page appearance={appearance} mode={match.mode} section={match.section} onOpenVersion={openVersion} />
              {active && <OpenVersion request={versionToOpen && resolveRoute(routeForVersion(versionToOpen.kind)).feature.id === match.feature.id ? versionToOpen : null} onOpened={() => setVersionToOpen(null)} />}
            </Suspense>
          </div>;
        })}
      </div>

    </main>
    <dialog ref={paletteDialog} aria-label="Command palette" aria-modal="true" className="command-palette"
      onCancel={(event) => { event.preventDefault(); closePalette(); }} onClick={(event) => { if (event.target === event.currentTarget) closePalette(); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)); }
        if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
      }}>
      <div className="palette-search"><Icon name="search" /><input ref={paletteInput} role="combobox" aria-label="Cari perintah" aria-autocomplete="list" aria-expanded={paletteOpen} aria-controls="palette-results" aria-activedescendant={filtered.length ? `palette-action-${paletteIndex}` : undefined}
        onChange={(event) => { setPaletteQuery(event.target.value); setPaletteIndex(0); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (filtered[paletteIndex]) choose(filtered[paletteIndex]); } }} placeholder="Cari editor atau pengaturan..." value={paletteQuery} /><kbd>esc</kbd></div>
      <div className="palette-results" id="palette-results" role="listbox" aria-label="Perintah">{filtered.map((action, index) => <button type="button" id={`palette-action-${index}`} tabIndex={-1} key={action.label} role="option" aria-selected={index === paletteIndex} className={index === paletteIndex ? 'is-selected' : ''} onClick={() => choose(action)}><Icon name={action.icon} /><span>{action.label}</span><Icon name="arrow" /></button>)}{!filtered.length && <p className="palette-empty" role="status">Tidak ada perintah yang cocok.</p>}</div>
      <footer className="palette-footer"><span>↑ ↓ Navigasi</span><span>Enter pilih</span></footer>
    </dialog>
  </div>;
}
