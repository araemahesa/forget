import { call } from './tauri';
export type ReferenceImage = { name: string; dataUrl?: string; kind?: 'image' | 'pdf' | 'video' | 'audio' | 'model3d' | 'text'; frames?: string[]; text?: string; summary?: string; size?: number };
export const referenceAccept = '.png,.jpg,.jpeg,.webp,.pdf,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.ogg,.flac,.aac,.glb,.fbx,.obj,.stl,.ply,.blend,.txt,.md,.json,.csv,.lua,.luau,.js,.ts,.py,.html,.css,.xml';
export const referenceFormats = 'PNG, JPG, JPEG, WebP, PDF, video, audio, 3D, teks/kode';
const fileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('File gagal dibaca.'));
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.readAsDataURL(file);
});
export async function readReference(file: File): Promise<ReferenceImage> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!referenceAccept.split(',').includes(`.${extension}`)) throw new Error('Format file belum didukung. Pilih gambar, PDF, video, audio, model 3D, atau teks/kode.');
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('File kosong atau melebihi 32 MiB.');
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return call<ReferenceImage>('prepare_attachment', { name: file.name, base64: await fileBase64(file) });
  if (file.size > 10 * 1024 * 1024) throw new Error('Gambar maksimal 10 MiB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024) throw new Error('Dimensi referensi terlalu besar.');
    let edge = 1536;
    while (edge >= 512) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Referensi gagal diproses.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length <= 2 * 1024 * 1024) return { name: file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'Referensi', dataUrl };
      edge = Math.floor(edge * .8);
    }
    throw new Error('Referensi terlalu besar setelah diperkecil.');
  } finally { URL.revokeObjectURL(url); }
}
