import { useEffect, useId, useRef, useState } from 'react';
import { call } from '../../services/tauri';
import { useFeatureProviderSelection } from '../../services/featureSelection';
import { loadProviderUsage } from '../../services/providerUsage';
import { ProviderPicker } from '../shared/ProviderPicker';
import { ModelControls } from '../shared/ModelControls';
import { MessageContent } from '../chat/MessageContent';
import type { HunyuanModel } from './hunyuanPreview';

type Entry = { role: 'user' | 'assistant'; content: string };
const key = (path: string) => `forgekit:model-edit:${path}`;
function history(path: string): Entry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(path)) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is Entry => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.length <= 16000).slice(-40) : [];
  } catch { return []; }
}
function persist(path: string, entries: Entry[]) {
  try { localStorage.setItem(key(path), JSON.stringify(entries.slice(-40))); } catch { /* Saved GLB remains available if UI history storage is full. */ }
}

export function ModelEditChat({ model, disabled, onBusyChange, onEdited }: {
  model: HunyuanModel | null; disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onEdited: (model: HunyuanModel) => Promise<void>;
}) {
  const id = useId();
  const selection = useFeatureProviderSelection('model3d');
  const { modelSelection, provider, profiles } = selection;
  const [input, setInput] = useState(''), [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), alive = useRef(true), textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setEntries(model ? history(model.relativePath) : []); setError('');
  }, [model?.relativePath]);

  async function submit() {
    const text = input.trim();
    if (lock.current || disabled) return;
    if (!model) { setError('Pilih model dari Riwayat Model terlebih dahulu.'); return; }
    if (!provider || !modelSelection.modelId) { setError('Pilih akun dan model AI terlebih dahulu.'); return; }
    if (!text || text.length > 8000) { setError('Tulis perubahan, maksimal 8.000 karakter.'); return; }
    const source = model, captured = { ...provider };
    const next: Entry[] = [...entries, { role: 'user', content: text }];
    lock.current = true; setBusy(true); onBusyChange(true); setError('');
    setEntries(next); persist(source.relativePath, next);
    try {
      const result = await call<{ model: HunyuanModel; summary: string }>('hunyuan_edit_model', {
        relativePath: source.relativePath, prompt: text, providerId: captured.id,
        modelId: modelSelection.modelId, reasoningEffort: modelSelection.effort || null,
      });
      if (!result?.model?.relativePath || typeof result.summary !== 'string') throw new Error('Respons revisi tidak sah. Periksa Riwayat Model sebelum mencoba lagi.');
      const completed: Entry[] = [...next, { role: 'assistant', content: result.summary }];
      persist(result.model.relativePath, completed);
      if (!alive.current) return;
      setEntries(completed); setInput('');
      try { await onEdited(result.model); }
      catch { if (alive.current) setError('Revisi sudah tersimpan, tetapi pratinjau gagal dimuat. Buka revisi lewat Riwayat Model.'); }
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : 'Revisi gagal. Model asal tetap tersimpan.');
    } finally {
      lock.current = false;
      if (alive.current) { setBusy(false); onBusyChange(false); textarea.current?.focus(); }
      void loadProviderUsage(captured, true);
    }
  }

  return <section className="hunyuan-ai-chat" aria-label="Edit objek dengan AI">
    <header className="hunyuan-section-heading"><h2>Edit dengan AI</h2><span className="hunyuan-meta">Revisi baru</span></header>
    <p className="generator-caption" id={`${id}-help`}>{model ? 'Model asli tetap aman.' : 'Pilih model dari riwayat untuk mengedit.'}</p>
    <div className="hunyuan-chat-log" role="log" aria-label="Percakapan revisi model" aria-live="polite" tabIndex={0}>
      {entries.map((entry, index) => <article key={index}>
        <strong>{entry.role === 'user' ? 'Kamu' : 'ForgeKit AI'}</strong>
        <MessageContent content={entry.content} plain={entry.role === 'user'} />
      </article>)}
    </div>
    <form className="hunyuan-chat-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor={`${id}-input`}>Perubahan objek</label>
      <textarea id={`${id}-input`} ref={textarea} name="prompt" rows={3} required maxLength={8000}
        value={input} onChange={event => setInput(event.target.value)} readOnly={busy}
        aria-describedby={`${id}-help ${id}-privacy`} placeholder="Contoh: tambahkan topi merah…"
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          event.preventDefault(); event.currentTarget.form?.requestSubmit();
        }} />
      <details className="hunyuan-advanced hunyuan-ai-settings">
        <summary><span>Pengaturan AI</span><span className="hunyuan-meta">{modelSelection.selected?.displayName || modelSelection.modelId || 'Pilih model'}</span></summary>
        <div className="hunyuan-chat-actions">
        <ProviderPicker label="Provider edit objek" profiles={profiles} connections={selection.connectionProfiles}
          value={selection.choice} onChange={selection.setChoice} disabled={busy || disabled}
          primaryProfile={selection.defaultProvider} isCustomOverride={selection.isCustomOverride} />
        <ModelControls selection={modelSelection} disabled={busy || disabled} />
        </div>
      </details>
      <p id={`${id}-privacy`} className="generator-caption hunyuan-privacy">Prompt, ringkasan objek &amp; Obsidian dikirim ke AI.</p>
      {!provider && <a href="#settings?section=providers">Atur provider AI</a>}
      {selection.fallbackNotice && <p className="generator-caption">{selection.fallbackNotice}</p>}
      <button className="button primary-button" type="submit" disabled={busy || disabled || !model}>
        {busy ? 'Membuat revisi…' : 'Kirim perubahan'}
      </button>
      {busy && <p className="generator-caption" role="status">Blender menyiapkan revisi…</p>}
      <details className="hunyuan-advanced hunyuan-editor-help"><summary>Info editor</summary><p className="generator-caption">Tambah komponen, ubah warna, bahan, ukuran, posisi, dan rotasi. Bagian satu mesh belum dapat dipilih terpisah; sculpting dan tekstur baru belum didukung. Blender menyimpan revisi lokal tanpa GPU; model asli tetap utuh.</p></details>
      {error && <p className="generator-error" role="alert">{error}</p>}
    </form>
  </section>;
}
