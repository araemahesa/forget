import { expect, it } from 'vitest';
import { Mesh, type MeshStandardMaterial } from 'three';
import { buildBlenderPreview } from './blenderPreview';
import { disposeGeometry, modelStatistics } from '../create/geometry';
const mesh = { id: 'body', name: 'Actual mesh', positions: [0,0,0, 2,0,0, 0,3,0], normals: [0,0,1,0,0,1,0,0,1], color: '#246bb3', material: 'Metal', roughness: .63, metalness: 0, opacity: .8, emissiveIntensity: .2 };
it('reads actual Blender triangles, normals, part identity and material values without a model export', () => {
  const group = buildBlenderPreview({schemaVersion:1,name:'Blender result',meshes:[mesh]});
  expect(modelStatistics(group)).toMatchObject({triangles:1,vertices:3,size:[2,3,0]});
  const object = group.children[0] as Mesh;
  const material = object.material as MeshStandardMaterial;
  expect(object.userData.partId).toBe('body'); expect(material.color.getHexString()).toBe('246bb3');
  expect(material.roughness).toBe(.63);expect(material.metalness).toBe(0);expect(material.opacity).toBe(.8);
  disposeGeometry(group);
});
it('rejects corrupt previews before passing data to the GPU', () => {
  for (const patch of [{positions:[1,2]}, {normals:[]}, {positions:[NaN,0,0,2,0,0,0,3,0]}, {normals:Array(9).fill(2)}, {color:'red'}, {roughness:5}]) {
    expect(() => buildBlenderPreview({schemaVersion:1,name:'Bad',meshes:[{...mesh,...patch}]})).toThrow();
  }
  expect(() => buildBlenderPreview({schemaVersion:1,name:'Bad',meshes:[mesh,mesh]})).toThrow();
});
it('preserves linear reference vertex colors and rejects malformed color buffers', () => {
  const colors = [1,0,0, 0,.5,0, 0,0,1];
  const group = buildBlenderPreview({schemaVersion:1,name:'Reference color',meshes:[{...mesh,colors}]});
  const object = group.children[0] as Mesh;
  expect(Array.from(object.geometry.attributes.color.array)).toEqual(colors);
  expect((object.material as MeshStandardMaterial).vertexColors).toBe(true);
  expect((object.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
  disposeGeometry(group);
  for (const bad of [[], [1,2,3], Array(9).fill(NaN), Array(9).fill(-.1), Array(9).fill(1.1), 'red']) {
    expect(() => buildBlenderPreview({schemaVersion:1,name:'Bad colors',meshes:[{...mesh,colors:bad}]})).toThrow(/Warna vertex/);
  }
});
it('loads only bounded embedded PNG textures with matching UVs and disposes their GPU resources', async () => {
  const THREE = await import('three');
  const { vi } = await import('vitest');
  const texture = new THREE.Texture<HTMLImageElement>();
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(texture);
  const dispose = vi.spyOn(texture, 'dispose');
  // A real 1x1 PNG; the browser decodes the complete image after admission checks.
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const textured = {...mesh, texture:{width:1,height:1,dataUrl},uvs:[0,0,1,0,0,1],colors:[1,0,0,1,0,0,1,0,0]};
  try {
    const group=buildBlenderPreview({schemaVersion:1,name:'Textured',meshes:[textured]});
    const object=group.children[0] as Mesh, material=object.material as MeshStandardMaterial;
    expect(material.map).toBe(texture);expect(material.vertexColors).toBe(false);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(Array.from(object.geometry.attributes.uv.array)).toEqual(textured.uvs);
    disposeGeometry(group);expect(dispose).toHaveBeenCalled();
    for (const patch of [{uvs:[]},{uvs:[-1,0,1,0,0,1]},{texture:{width:2049,height:1,dataUrl}}, {texture:{width:2,height:1,dataUrl}}, {texture:{width:1,height:1,dataUrl:'https://example.org/image.png'}}, {texture:{width:1,height:1,dataUrl:'data:image/png;base64,YmFk'}}]) {
      expect(()=>buildBlenderPreview({schemaVersion:1,name:'Bad texture',meshes:[{...textured,...patch}]})).toThrow();
    }
    expect(load).toHaveBeenCalledOnce();
  } finally {vi.restoreAllMocks();}
});
