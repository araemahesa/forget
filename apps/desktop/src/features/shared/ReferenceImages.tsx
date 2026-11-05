import { useId, useRef, useState, type ReactNode, type DragEvent } from 'react';
import { readReference, referenceAccept, referenceFormats, type ReferenceImage } from '../../services/references';
import { Icon } from '../../design-system/Icon';
export function ReferenceImages({ value, onChange, disabled = false, compact = false, children, onBusyChange, imagesOnly = false, maxFiles = 3 }: { maxFiles?: 1 | 3; imagesOnly?: boolean; value: ReferenceImage[]; onChange: (images: ReferenceImage[]) => void; disabled?: boolean; compact?: boolean; children?: ReactNode; onBusyChange?: (busy: boolean) => void }) {
  const id = useId(); const [error, setError] = useState(''); const [reading, setReading] = useState(false); const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); const busy = useRef(false);
  async function add(files: File[]) {
    if (!files.length || disabled || busy.current) return;
    busy.current = true; setError(''); setReading(true); onBusyChange?.(true);
    try {
      if (imagesOnly && files.some(file => !/\.(png|jpe?g|webp)$/i.test(file.name))) throw new Error('Pilih gambar PNG, JPG atau WebP untuk membuat model 3D.');
      if (files.length + value.length > maxFiles) throw new Error(maxFiles === 1 ? 'Gunakan satu gambar untuk membuat objek 3D.' : 'Maksimal 3 lampiran referensi.');
      if (files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024) throw new Error('Total file yang dipilih maksimal 64 MiB.');
      const attachments: ReferenceImage[] = [];
      for (const file of files) attachments.push(await readReference(file));
      onChange([...value, ...attachments]);
    } catch (error) { setError(error instanceof Error ? error.message : 'Lampiran gagal dibaca.'); }
    finally { busy.current = false; setReading(false); onBusyChange?.(false); }
  }
  function dragOver(event: DragEvent) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = disabled || reading ? 'none' : 'copy';
    if (!disabled && !reading) setDragging(true);
  }
  return <div className={`reference-images${compact ? ' is-compact chat-composer-input' : ''}${dragging ? ' is-dragging' : ''}`} onDragOver={dragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void add(Array.from(event.dataTransfer.files)); }}>
    <button type="button" className={compact ? 'reference-attach theme-button' : 'reference-attach reference-picker'} aria-label="Lampirkan file referensi" title={`Klik atau seret file · ${imagesOnly ? 'PNG, JPG, WebP' : referenceFormats} · ${value.length}/${maxFiles}`} disabled={disabled || reading || value.length >= maxFiles} onClick={() => inputRef.current?.click()}>
      <Icon name="plus" />
      {!compact && <span>Tambahkan referensi</span>}
      {(!compact || !!value.length) && <span className="reference-count">{compact ? value.length : `${value.length}/${maxFiles}`}</span>}
    </button>
    <input ref={inputRef} id={id} aria-label="Pilih file referensi" hidden type="file" accept={imagesOnly ? '.png,.jpg,.jpeg,.webp' : referenceAccept} multiple={maxFiles > 1} disabled={disabled || reading || value.length >= maxFiles} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void add(files); }} />
    {children}
    {dragging && <div className="reference-drop-overlay"><Icon name="upload" /><strong>Lepaskan file di sini</strong><span>{imagesOnly ? 'PNG, JPG, WebP' : 'Gambar, PDF, video, suara, model 3D atau teks'}</span></div>}
    {!!value.length && <div className="reference-thumbnails attachment-cards">{value.map((file, index) => {
      const preview = file.dataUrl || file.frames?.[0];
      return <figure key={`${file.name}-${index}`}>
        {preview ? <img src={preview} alt={`Referensi ${file.name}`} /> : <div className="attachment-file-icon"><Icon name={file.kind === 'audio' ? 'wave' : 'layers'} /><span>{file.kind === 'audio' ? 'AUDIO' : 'TEKS'}</span></div>}
        <figcaption title={`${file.name}\n${file.summary ?? ''}`}><strong>{file.name}</strong><span>{file.summary || 'Gambar referensi'}</span></figcaption>
        <button type="button" className="theme-button" aria-label={`Hapus referensi ${file.name}`} disabled={disabled || reading} onClick={() => onChange(value.filter((_, i) => i !== index))}><Icon name="close" /></button>
      </figure>;
    })}</div>}
    {!compact && <details className="reference-help"><summary>Format & batas lampiran</summary><p className="generator-caption reference-disclosure">Seret file ke sini atau pilih file. {imagesOnly ? `Maksimal ${maxFiles} gambar, masing-masing 10 MiB.` : 'Maksimal 3 lampiran; gambar 10 MiB, file lain 32 MiB.'} Hasil ekstraksi dikirim ke provider pilihan.</p></details>}
    {compact && !!value.length && <p className="generator-caption reference-disclosure">Isi hasil pemrosesan dikirim bersama pesan ke akun AI pilihan.</p>}
    {reading && <p role="status">Menyiapkan lampiran… PDF, video, suara, dan 3D dapat memerlukan beberapa menit.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
