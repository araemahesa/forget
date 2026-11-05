import { readableError } from './readableError';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../../services/tauri';
import { useStudioSnapshot } from '../../services/studioState';
import { Icon } from '../../design-system/Icon';

type Segment = { name: string; id: string };
export type ExplorerNode = { id: string; name: string; className: string; path: Segment[]; displayPath: string; childCount: number };
type Page = { epoch: string; nodes: ExplorerNode[]; total: number; more?: boolean; partial: boolean; properties?: Record<string, string>; scanned?: number };
type Branch = { nodes: ExplorerNode[]; total?: number; more?: boolean; loading?: boolean; error?: string };
const rootKey = '$root';
export function StudioExplorer({ inline = false }: { inline?: boolean }) {
  const studio = useStudioSnapshot();
  const target = studio?.studio.studioId;
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(320);
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootKey]));
  const [selected, setSelected] = useState<ExplorerNode | null>(null);
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [propertyError, setPropertyError] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [scroll, setScroll] = useState(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const branchCache = useRef(branches); branchCache.current = branches;
  const revision = useRef(0);
  const epoch = useRef<string | null>(null);
  const active = useRef(target); active.current = target;
  const pending = useRef(new Map<string, Promise<Page>>());
  const selection = useRef<string | null>(null); selection.current = selected?.id ?? null;
  const request = useCallback(async (action: string, path: Segment[], offset = 0, text = '') => {
    const captured = revision.current;
    const key = JSON.stringify([target, action, path, offset, text, epoch.current]);
    let operation = pending.current.get(key);
    if (!operation) {
      operation = call<Page>('read_studio_explorer', { studioId: target, query: { action, path, offset, search: text, epoch: action === 'children' && !path.length ? null : epoch.current } });
      pending.current.set(key, operation);
      void operation.finally(() => pending.current.delete(key)).catch(() => {});
    }
    const result = await operation;
    if (captured !== revision.current || active.current !== target) throw new Error('Respons map lama diabaikan.');
    if (!result || typeof result.epoch !== 'string' || !Array.isArray(result.nodes)) throw new Error('Respons Explorer tidak sah.');
    if (epoch.current && epoch.current !== result.epoch) {
      revision.current++; epoch.current = null; setBranches({}); setSelected(null); setProperties({});
      throw new Error('Sesi map berubah. Muat ulang Explorer.');
    }
    epoch.current = result.epoch;
    return result;
  }, [target]);
  const load = useCallback(async (node: ExplorerNode | null, offset = 0, refresh = false) => {
    const id = node?.id ?? rootKey;
    const captured = revision.current;
    setBranches(items => ({ ...items, [id]: { ...items[id], nodes: items[id]?.nodes ?? [], loading: true, error: '' } }));
    try {
      let result = await request('children', node?.path ?? [], offset);
      if (refresh && offset === 0) {
        const count = branchCache.current[id]?.nodes.length ?? 0;
        while (result.more && result.nodes.length < count) {
          const page = await request('children', node?.path ?? [], result.nodes.length);
          if (!page.nodes.length) break;
          result = { ...page, nodes: [...result.nodes, ...page.nodes] };
        }
      }
      if (captured !== revision.current) return;
      setBranches(items => ({ ...items, [id]: { nodes: offset ? [...(items[id]?.nodes ?? []).slice(0, offset), ...result.nodes] : result.nodes, total: result.total, more: result.more, loading: false } }));
      setError('');
    } catch (failure) {
      if (captured === revision.current) setBranches(items => ({ ...items, [id]: { ...items[id], nodes: items[id]?.nodes ?? [], loading: false, error: String(failure instanceof Error ? failure.message : failure) } }));
    }
  }, [request]);
  const inspect = useCallback(async (node: ExplorerNode) => {
    setSelected(node); setProperties({}); setPropertyError('');
    try { const result = await request('properties', node.path); if (selection.current === node.id) setProperties(result.properties ?? {}); }
    catch (failure) { if (selection.current === node.id) setPropertyError(failure instanceof Error ? failure.message : String(failure)); }
  }, [request]);
  useEffect(() => {
    revision.current++; epoch.current = null; pending.current.clear(); setBranches({}); setExpanded(new Set([rootKey])); setSelected(null); setProperties({}); setQuery(''); setSearch(null); setError('');
    if (target) { setOpen(true); void load(null); }
    return () => { revision.current++; };
  }, [target, load]);
  useEffect(() => {
    if (!target || !open) return;
    let stopped = false;
    const refresh = async () => { if (!document.hidden) { await load(null, 0, true); if (!stopped && selected) { if (expanded.has(selected.id)) await load(selected, 0, true); try { const result = await request('properties', selected.path); if (!stopped && selection.current === selected.id) setProperties(result.properties ?? {}); } catch (failure) { if (!stopped) setPropertyError(failure instanceof Error ? failure.message : String(failure)); } } } };
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => void refresh(); window.addEventListener('focus', focus);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [target, open, load, request, selected, expanded]);
  useEffect(() => {
    if (!target || !query.trim()) { setSearch(null); return; }
    let stopped = false;
    const timer = setTimeout(() => { void request('search', [], 0, query.trim()).then(value => { if (!stopped) { setSearch(value); setError(''); } }).catch(failure => { if (!stopped) setError(failure instanceof Error ? failure.message : String(failure)); }); }, 400);
    return () => { stopped = true; clearTimeout(timer); };
  }, [target, query, request]);
  useEffect(() => {
    document.documentElement.style.setProperty('--explorer-width', `${width}px`);
    return () => { document.documentElement.style.removeProperty('--explorer-width'); };
  }, [width]);
  useEffect(() => {
    if (open && target && window.matchMedia('(max-width: 1100px)').matches) searchInput.current?.focus();
  }, [open, target]);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  if (!target) return null;
  type Row = { node?: ExplorerNode; depth: number; parent?: ExplorerNode | null; more?: boolean; label?: string };
  const rows: Row[] = [];
  const visit = (parent: ExplorerNode | null, depth: number) => {
    const branch = branches[parent?.id ?? rootKey];
    if (!branch) { rows.push({ depth, label: 'Belum dimuat' }); return; }
    for (const node of branch.nodes) { rows.push({ node, depth }); if (expanded.has(node.id)) visit(node, depth + 1); }
    if (branch.loading) rows.push({ depth, label: 'Memuat…' });
    else if (branch.error) rows.push({ depth, parent, label: branch.error });
    else if (branch.more) rows.push({ depth, parent, more: true });
    else if (!branch.nodes.length) rows.push({ depth, label: 'Kosong' });
  };
  if (query.trim()) for (const node of search?.nodes ?? []) rows.push({ node, depth: 0 }); else visit(null, 0);
  const start = Math.max(0, Math.floor(scroll / 32) - 5);
  const windowRows = rows.slice(start, start + 65);
  return <>
    {!inline && <button ref={toggle} className="explorer-toggle theme-button" type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="studio-explorer" title="Explorer map" aria-label="Explorer map bersama"><Icon name="workspace" /></button>}
    {open && <aside id="studio-explorer" className={`studio-explorer${inline ? ' is-inline' : ''}`} style={inline ? undefined : { width }} aria-label="Explorer dan Properties" onKeyDown={event => {
      if (inline || !window.matchMedia('(max-width: 1100px)').matches) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"], summary'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      {!inline && <div role="separator" aria-label="Lebar Explorer" aria-orientation="vertical" tabIndex={0} className="explorer-resizer" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setWidth(value => Math.max(280, Math.min(360, value + (event.key === 'ArrowLeft' ? 8 : -8)))); } }} onPointerDown={event => { const handle = event.currentTarget; handle.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(280, Math.min(360, window.innerWidth - event.clientX))); }} />}
      <header><strong>Explorer</strong><button className="theme-button" type="button" aria-label="Muat ulang Explorer" onClick={() => { epoch.current = null; revision.current++; setBranches({}); void load(null); }}><Icon name="refresh" /></button>{!inline && <button className="theme-button" type="button" aria-label="Tutup Explorer" onClick={close}><Icon name="close" /></button>}</header>
      <p className="explorer-map-name" title={studio.studio.name}>{studio.studio.name || 'Map Studio'} <small>Edit · baca saja</small></p>
      <input ref={searchInput} aria-label="Cari objek map" placeholder="Cari nama, class, atau path…" value={query} onChange={event => { setQuery(event.target.value); setScroll(0); }} />
      {error && <p role="alert">{readableError(error)}</p>}
      {query && <small>{search ? `${search.nodes.length} dari ${search.total} kecocokan${search.partial ? ' · cakupan parsial (batas inspeksi)' : ''}` : 'Mencari…'}</small>}
      <div className="explorer-tree" role="tree" aria-label="Hierarki Studio live" onScroll={event => setScroll(event.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * 32, position: 'relative' }}>
          {windowRows.map((row, index) => <div key={row.node?.id ?? `status-${start + index}`} style={{ position: 'absolute', top: (start + index) * 32, paddingLeft: 4 + row.depth * 16 }} className={`explorer-row${row.node?.id === selected?.id ? ' is-selected' : ''}`}>
            {row.node ? <><button type="button" className="explorer-expand" disabled={!row.node.childCount} aria-label={`${expanded.has(row.node.id) ? 'Tutup' : 'Buka'} ${row.node.name}`} onClick={() => { const node = row.node!; setExpanded(items => { const next = new Set(items); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); if (!branches[node.id]) void load(node); }}>{row.node.childCount ? expanded.has(row.node.id) ? '⌄' : '›' : '·'}</button><button type="button" role="treeitem" aria-level={row.depth + 1} aria-selected={selected?.id === row.node.id} title={`${row.node.name} · ${row.node.className}\n${row.node.displayPath}`} onClick={() => { selection.current = row.node!.id; void inspect(row.node!); }}><Icon name={/Script/.test(row.node.className) ? 'command' : 'workspace'} /><span>{row.node.name}</span><small>{row.node.className}</small><small>{row.node.childCount || ''}</small></button></> : row.more || row.parent !== undefined ? <button type="button" className="explorer-load" onClick={() => void load(row.parent ?? null, row.more ? branches[row.parent?.id ?? rootKey]?.nodes.length : 0)}>{row.more ? 'Muat berikutnya' : row.label}</button> : <small>{row.label}</small>}
          </div>)}
        </div>
      </div>
      {query && search?.more && <button className="button secondary-button" type="button" onClick={() => void request('search', [], search.nodes.length, query).then(value => setSearch({ ...value, nodes: [...search.nodes, ...value.nodes] })).catch(failure => setError(String(failure)))}>Hasil berikutnya</button>}
      <details className="explorer-properties" open><summary>Properties</summary><small>Properti inti yang dapat dibaca · source script tidak dikirim ke provider</small>{selected ? <><p className="explorer-breadcrumb" title={selected.displayPath}>{selected.displayPath}</p>{propertyError ? <p role="alert">{propertyError}</p> : Object.keys(properties).length ? <dl>{Object.entries(properties).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : <p>Memuat properti…</p>}</> : <p>Pilih objek untuk memeriksa properti live.</p>}</details>
      <footer><small>{branches[rootKey]?.nodes.length ?? 0}{branches[rootKey]?.total !== undefined ? ` / ${branches[rootKey].total}` : ''} root termuat · cabang dimuat saat dibuka</small></footer>
    </aside>}
  </>;
}
