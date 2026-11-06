import { useEffect, useRef, useState } from 'react';
import type { ReferenceImage } from '../../services/references';
export function BlenderComparison({ references, views, review }: { references: ReferenceImage[]; views: ReferenceImage[]; review?: { decision: string; differences: string[]; unseen: string[] } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<ReferenceImage | null>(null), [zoom, setZoom] = useState(100);
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  function pictures(images: ReferenceImage[], prefix: string) {
    return <div className="reference-thumbnails">{images.map((image, i) => <figure key={`${prefix}-${i}`}><button type="button" aria-label={`Perbesar ${image.name}`} onClick={() => { setZoom(100); setSelected(image); }}><img src={image.dataUrl} alt={image.name} /></button><figcaption>{image.name.replace('view-','').replace('.png','')}</figcaption></figure>)}</div>;
  }
  return <>
    <details className="reference-comparison" open><summary>Render Blender</summary>
      {pictures(views,'render')}
      <details className="model-result-details"><summary>Referensi & pemeriksaan</summary>{pictures(references,'ref')}
      {review && <div className="generator-caption">{review.decision !== 'accept' && <p>Masih ada perbedaan dengan referensi.</p>}{review.differences.map((text,i) => <p key={i}>{text}</p>)}{review.unseen.map((text,i) => <p key={`u-${i}`}>{text}</p>)}</div>}
      </details>
    </details>
    <dialog ref={dialog} className="reference-image-dialog" aria-label="Periksa detail referensi" onClose={() => setSelected(null)}>
      <header><strong>{selected?.name}</strong><label>Zoom<input aria-label="Zoom gambar" type="range" min={50} max={250} step={25} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label><button type="button" className="button secondary-button" onClick={() => dialog.current?.close()}>Tutup</button></header>
      <div className="reference-image-pan">{selected && <img src={selected.dataUrl} alt={selected.name} style={{ width: `${zoom}%` }} />}</div>
    </dialog>
  </>;
}
