import { Dropdown } from '../../design-system/Dropdown';
import { useEffect, useState, type ReactNode } from 'react';

export function EditorModes({ label, mode, modes, render, keyFor = (id) => id }: {
  label: string; mode?: string; modes: Record<string, string>; render: (mode: string) => ReactNode; keyFor?: (mode: string) => string;
}) {
  const selected = mode && mode in modes ? mode : Object.keys(modes)[0];
  const selectedKey = keyFor(selected);
  const [visited, setVisited] = useState<string[]>([selectedKey]);
  useEffect(() => { setVisited((items) => items.includes(selectedKey) ? items : [...items, selectedKey]); }, [selectedKey]);
  function select(value: string) {
    const [path, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    params.set('mode', value);
    window.location.hash = `${path}?${params}`;
  }
  return <section aria-label={label}>
    <div className="editor-mode-bar"><h1>{label}</h1><label>Jenis output
      <Dropdown aria-label={`Mode ${label}`} value={selected} onChange={(event) => select(event.target.value)}>
        {Object.entries(modes).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </Dropdown>
    </label></div>
    {[...new Set([...visited, selectedKey])].map((id) => <div key={id} hidden={id !== selectedKey}>{render(id)}</div>)}
  </section>;
}
