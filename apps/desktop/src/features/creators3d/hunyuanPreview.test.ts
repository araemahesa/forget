import { expect, it, vi } from 'vitest';
import type { TextureLoader as ImageTextureLoader } from 'three';
import { glbBytes, hunyuanJobActive } from './hunyuanPreview';

function glb(document: unknown) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const bytes = new Uint8Array(20 + json.length);
  const view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, json.length, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  bytes.set(json, 20);
  return btoa(String.fromCharCode(...bytes));
}
it('accepts embedded GLB bytes and rejects external resources before loader runs', () => {
  expect(glbBytes(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 0 }], images: [{ bufferView: 0, mimeType: 'image/png' }] })).byteLength).toBeGreaterThan(20);
  for (const uri of ['https://example.com/private.png', 'file:///etc/passwd', '../image.png', 'data:text/html;base64,YQ==']) {
    expect(() => glbBytes(glb({ images: [{ uri }] }))).toThrow(/sumber eksternal/);
  }
  expect(() => glbBytes(btoa('invalid'))).toThrow(/GLB/);
});
it('only polls queued and running jobs', () => {
  expect(hunyuanJobActive(null)).toBe(false);
  for (const status of ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const) {
    expect(hunyuanJobActive({ id: 'a'.repeat(32), status })).toBe(['queued', 'running'].includes(status));
  }
});
it('loads actual embedded triangle geometry without WebGL or remote resource fetches', async () => {
  const { loadHunyuanPreview } = await import('./hunyuanPreview');
  const { disposeGeometry } = await import('../create/geometry');
  const { Mesh } = await import('three');
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] };
  const json = new TextEncoder().encode(JSON.stringify(document).padEnd(Math.ceil(JSON.stringify(document).length / 4) * 4, ' '));
  const bytes = new Uint8Array(28 + json.length + 36);
  const view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, json.length, 0x4e4f534a].forEach((value, index) => view.setUint32(index * 4, value, true));
  bytes.set(json, 20); view.setUint32(20 + json.length, 36, true); view.setUint32(24 + json.length, 0x004e4942, true);
  new Float32Array(bytes.buffer, 28 + json.length, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const scene = await loadHunyuanPreview(btoa(String.fromCharCode(...bytes)));
  let vertices = 0;
  scene.traverse(object => { if (object instanceof Mesh) vertices += object.geometry.getAttribute('position').count; });
  expect(vertices).toBe(3);
  expect(scene.name).toBe('Hunyuan3D-2');
  disposeGeometry(scene);
});

function texturedTriangle() {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    buffers: [{ byteLength: 60 + png.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: png.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    images: [{ bufferView: 2, mimeType: 'image/png' }], textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }] };
  const text = JSON.stringify(document);
  const json = new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const size = Math.ceil((60 + png.length) / 4) * 4;
  const bytes = new Uint8Array(28 + json.length + size);
  const view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, json.length, 0x4e4f534a].forEach((v, i) => view.setUint32(i * 4, v, true));
  bytes.set(json, 20); view.setUint32(20 + json.length, size, true); view.setUint32(24 + json.length, 0x004e4942, true);
  new Float32Array(bytes.buffer, 28 + json.length, 15).set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1]);
  bytes.set(png, 28 + json.length + 60);
  return btoa(String.fromCharCode(...bytes));
}
it('loads embedded color with image loader and preserves sRGB, UVs and material', async () => {
  const { Texture, TextureLoader, Mesh, MeshStandardMaterial, SRGBColorSpace } = await import('three');
  const { loadHunyuanPreview } = await import('./hunyuanPreview');
  const { disposeGeometry } = await import('../create/geometry');
  vi.stubGlobal('createImageBitmap', vi.fn(() => { throw new Error('must not use bitmap fetch'); }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('must not fetch blob textures'); }));
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:embedded-color', revokeObjectURL: vi.fn() });
  const load = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(function (this: ImageTextureLoader, url, onLoad) {
    this.manager.itemStart(url);
    const texture = new Texture({ width: 1, height: 1 } as HTMLImageElement);
    queueMicrotask(() => { onLoad?.(texture); this.manager.itemEnd(url); });
    return texture;
  });
  try {
    const scene = await loadHunyuanPreview(texturedTriangle());
    scene.traverse(node => {
      if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) {
        expect((node.material.map?.image as HTMLImageElement).width).toBe(1);
        expect(node.material.map?.colorSpace).toBe(SRGBColorSpace);
        expect(node.material.map?.flipY).toBe(false);
        expect(node.geometry.getAttribute('uv').count).toBe(3);
      }
    });
    expect(load).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
    disposeGeometry(scene);
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
it('reports texture decode failure instead of silently displaying a white model', async () => {
  const { Texture, TextureLoader } = await import('three');
  const { loadHunyuanPreview } = await import('./hunyuanPreview');
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:broken-image', revokeObjectURL: vi.fn() });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(function (this: ImageTextureLoader, url, _onLoad, _progress, onError) {
    this.manager.itemStart(url);
    queueMicrotask(() => { onError?.(new Error('decode failed')); this.manager.itemError(url); this.manager.itemEnd(url); });
    return new Texture();
  });
  try { await expect(loadHunyuanPreview(texturedTriangle())).rejects.toThrow('Tekstur gagal dimuat'); }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
