import * as THREE from 'three';
import { model3dSurface, validateModel3dRecipe, type Model3dPart } from '@forgekit/contracts';
import { disposeGeometry } from '../create/geometry';

function referenceTexture(value: unknown) {
  const texture = value as { width: number; height: number; dataUrl: string };
  if (!texture || !Number.isInteger(texture.width) || !Number.isInteger(texture.height) || texture.width < 1 || texture.height < 1 || texture.width > 2048 || texture.height > 2048 || typeof texture.dataUrl !== 'string' || texture.dataUrl.length > 16*1024*1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(texture.dataUrl)) throw new Error('Tekstur referensi Blender tidak sah.');
  let bytes: string;
  try { bytes = atob(texture.dataUrl.slice(22)); } catch { throw new Error('PNG tekstur Blender tidak sah.'); }
  if (bytes.length < 33 || bytes.slice(0,8) !== '\x89PNG\r\n\x1a\n' || bytes.slice(12,16) !== 'IHDR') throw new Error('PNG tekstur Blender tidak sah.');
  const size = new DataView(Uint8Array.from(bytes.slice(16,24), c => c.charCodeAt(0)).buffer);
  if (size.getUint32(0) !== texture.width || size.getUint32(4) !== texture.height) throw new Error('Dimensi tekstur Blender tidak sesuai.');
  return texture;
}

export function buildBlenderPreview(value: unknown) {
  const data = value as { schemaVersion: number; name: string; meshes: Record<string, unknown>[] };
  if (!data || data.schemaVersion !== 1 || typeof data.name !== 'string' || !Array.isArray(data.meshes) || !data.meshes.length || data.meshes.length > 128) throw new Error('Pratinjau Blender tidak sah.');
  const group = new THREE.Group(); group.name = data.name;
  let triangles = 0, textures = 0, texturePixels = 0;
  const ids = new Set<string>();
  try {
    for (const item of data.meshes) {
      if (!item || typeof item !== 'object') throw new Error('Mesh Blender tidak sah.');
      const part = { id: item.id, name: item.name, primitive: 'cube', position: [0,0,0], rotation: [0,0,0], size: [1,1,1], color: item.color, material: item.material,
        ...Object.fromEntries(['roughness','metalness','opacity','emissiveIntensity'].filter(key => Object.hasOwn(item,key)).map(key => [key,item[key]])) } as Model3dPart;
      if (validateModel3dRecipe({ name: data.name, category: 'prop', seed: 0, exportFormat: 'blend', parts: [part] }).length || ids.has(part.id)) throw new Error('Identitas atau permukaan mesh Blender tidak sah.');
      ids.add(part.id);
      const positions = item.positions, normals = item.normals, colors = item.colors;
      if (!Array.isArray(positions) || !positions.length || positions.length % 9 || positions.length > 1800000 || !Array.isArray(normals) || normals.length !== positions.length) throw new Error('Buffer mesh Blender tidak sah.');
      triangles += positions.length / 9;
      if (triangles > 200000 || !positions.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20000) || !normals.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.001)) throw new Error('Mesh Blender melampaui batas atau memuat angka tidak sah.');
      if (colors !== undefined && (!Array.isArray(colors) || colors.length !== positions.length || !colors.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error('Warna vertex Blender tidak sah.');
      const texture = item.texture === undefined ? null : referenceTexture(item.texture);
      if (texture && (texturePixels += texture.width*texture.height) > 4*1024*1024) throw new Error('Tekstur Blender melampaui anggaran piksel.');
      const uvs = item.uvs;
      if (texture && (++textures > 4 || !Array.isArray(uvs) || uvs.length !== positions.length/3*2 || !uvs.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error('UV tekstur Blender tidak sah.');
      if (!texture && uvs !== undefined) throw new Error('UV Blender memerlukan tekstur.');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
      if (Array.isArray(colors)) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
      const surface = model3dSurface(part);
      if (texture) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs as number[],2));
      const baseColor = colors || texture ? '#ffffff' : part.color;
      const material = new THREE.MeshStandardMaterial({ color: baseColor, vertexColors: !!colors && !texture, ...surface, transparent: surface.opacity < 1, emissive: surface.emissiveIntensity ? baseColor : '#000000' });
      if (texture) {
        let disposed = false;
        material.addEventListener('dispose', () => { disposed = true; });
        material.map = new THREE.TextureLoader().load(texture.dataUrl,
          loaded => { if (disposed) loaded.dispose(); }, undefined,
          () => { if (disposed) return; material.map?.dispose(); material.map = null; material.vertexColors = !!colors; material.needsUpdate = true; });
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = 4;
      }
      const mesh = new THREE.Mesh(geometry,material); mesh.name = part.name; mesh.userData.partId = part.id;
      group.add(mesh);
    }
    return group;
  } catch (error) { disposeGeometry(group); throw error; }
}
