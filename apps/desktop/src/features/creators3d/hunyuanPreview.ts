import { LoadingManager, TextureLoader } from 'three';
import { disposeGeometry } from '../create/geometry';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type HunyuanConfig = { endpoint: string; hasToken: boolean; configured: boolean };
export type HunyuanJob = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; stage?: string; error?: string; obsidianWarning?: string; obsidianSnapshot?: { sentToWorker: boolean } };
export type HunyuanModel = { relativePath: string; sha256: string; byteLength: number; model: string; jobId: string; parentJobId?: string; summary?: string };
export const hunyuanJobActive = (job: HunyuanJob | null) => !!job && (job.status === 'queued' || job.status === 'running');

export function glbBytes(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB Hunyuan tidak sah.');
  const length = view.getUint32(12, true);
  if (length > bytes.length - 20) throw new Error('JSON GLB terpotong.');
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  for (const resource of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (resource.uri !== undefined && (typeof resource.uri !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(resource.uri))) throw new Error('Pratinjau memerlukan GLB mandiri, tanpa sumber eksternal.');
  }
  return bytes;
}

export async function loadHunyuanPreview(base64: string) {
  const bytes = glbBytes(base64);
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:') && !/^data:image\/(png|jpeg|webp);base64,/.test(url)) throw new Error('Sumber eksternal GLB diblokir.');
    return url;
  });
  let textureFailed = false;
  manager.onError = () => { textureFailed = true; };
  const loader = new GLTFLoader(manager);
  loader.register(parser => ({
    name: 'ForgeKitEmbeddedImages',
    beforeRoot() {
      // Use CSP-permitted img-src blob:, not ImageBitmapLoader's connect-src fetch.
      parser.textureLoader = new TextureLoader(manager);
      return null;
    },
  }));
  const result = await loader.parseAsync(bytes.buffer, '');
  if (textureFailed) {
    disposeGeometry(result.scene);
    throw new Error('Tekstur gagal dimuat. Model asli tetap tersimpan; buka ulang pratinjau atau Blender.');
  }
  result.scene.name = 'Hunyuan3D-2';
  return result.scene;
}
