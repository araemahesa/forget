"""Run with installed Blender in background. Isolated orthographic fixtures, no provider/Studio.

Checks a stepped solid with an actual through-hole, reference color, reopen, and rendered
silhouette overlap. The fixture score is not evidence of general photo reconstruction quality.
"""
import base64
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import zlib

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
RUNNER = Path(sys.argv[sys.argv.index('--')+1]).resolve()/'runner'
RUNNER.mkdir(parents=True, exist_ok=True)
for name in ['blender_build.py','blender_reference.py','blender_reconstruction.py', 'blender_texture.py']:
    shutil.copy2(ROOT/'apps/desktop/src-tauri/src'/name, RUNNER/name)
shutil.copy2(ROOT/'packages/contracts/src/model3d-materials.json', RUNNER/'model3d-materials.json')
sys.path.insert(0, str(RUNNER))
from blender_build import build
from blender_reconstruction import prepare_view, carve, boundary_mesh, linear_rgb
from blender_texture import atlas_layout


def png(path, pixels):
    height, width = pixels.shape[:2]
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data)&0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB', width,height,8,6,0,0,0))+
                     chunk(b'IDAT', zlib.compress(b''.join(b'\0'+row.tobytes() for row in pixels)))+chunk(b'IEND', b''))


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    for components in range(1,5):
        for view_count in range(2,7):
            columns, rows, side = atlas_layout(view_count,4*1024*1024//components)
            assert columns*rows*side*side*components<=4*1024*1024
            assert columns*side<=2048 and rows*side<=2048 and side>=256
    size = [3,3,2]
    specs, references, originals = [], [], []
    for index, name in enumerate(['front','right','top']):
        width, height = {'front':(3,3),'right':(2,3),'top':(3,2)}[name]
        yy, xx = np.mgrid[:320,:320]
        x, y = (xx+0.5-160)/80/width, (160-yy-0.5)/80/height
        mask = (np.abs(x)<=.5)&(np.abs(y)<=.5)
        if name == 'front':
            mask &= ((x<=.05)|(y<=.05)) & ((x+.22)**2+(y+.17)**2>.14**2)
        pixels = np.zeros((320,320,4), dtype=np.uint8)
        pixels[mask] = [197,18,50,255]
        if name == 'front':
            pixels[mask & (x>.1) & (y<-.3)] = [240,240,240,255]
            pixels[mask & ((xx==88)|(xx==89))] = [255,204,0,255]
        path=output/f'source-{name}.png'
        png(path,pixels)
        view=dict(image=index, view=name, crop=[0,0,1,1], background='alpha', tolerance=.06)
        specs.append(view)
        originals.append(prepare_view(pixels.astype(np.float32)/255,view,size))
        references.append(dict(name=name, dataUrl='data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode()))
    part=dict(id='stepped',name='Stepped reference with through-hole',primitive='reconstruction',
              position=[0,0,0],size=size,rotation=[0,0,0],color='#666666',material='Plastic',roughness=.55,
              reconstruction=dict(resolution=96,views=specs))
    recipe=dict(name='Reference-driven stepped solid',category='prop',seed=0,exportFormat='blend',parts=[part])
    (output/'recipe.json').write_text(json.dumps(recipe))
    (output/'references.json').write_text(json.dumps(references))
    # Guard failures are explicit, before any model file can be admitted.
    negative = []
    for label, pixels, spec in [
        ('opaque alpha', np.ones((32,32,4), dtype=np.float32), specs[0]),
        ('background only', np.zeros((32,32,4), dtype=np.float32), specs[0]),
        ('wrong proportions', np.pad(np.ones((3,20,4), dtype=np.float32), ((5,5),(5,5),(0,0))), specs[0]),
    ]:
        try:
            prepare_view(pixels,spec,size)
        except ValueError:
            negative.append(label)
        else:
            raise AssertionError(label+' must be rejected')
    # An inconsistent top view must not quietly create an unrelated substitute.
    inconsistent = [dict(view=v['view'], image=v['image'], mask=v['mask'].copy(), pixels=v['pixels']) for v in originals]
    inconsistent[-1]['mask'][:,:80] = False
    try:
        carve(inconsistent,64)
    except ValueError:
        negative.append('inconsistent silhouettes')
    else:
        raise AssertionError('inconsistent silhouettes must be rejected')
    if not (output/'metrics.json').exists():
        build(recipe, output)
    else:
        bpy.ops.wm.open_mainfile(filepath=str(output/'model.blend'),load_ui=False,use_scripts=False)
    metrics=json.loads((output/'metrics.json').read_text())
    assert metrics['blendReopened'] and metrics['referenceImagesPacked']==3
    assert 1000<metrics['triangles']<=200000
    obj=next(o for o in bpy.data.objects if o.get('ForgeKitPartId'))
    topology=bmesh.new();topology.from_mesh(obj.data)
    assert all(e.is_manifold for e in topology.edges)
    assert topology.calc_volume(signed=True)>0
    topology.free()
    assert not obj.ray_cast(Vector((-.66,-.51,3)),Vector((0,0,-1)))[0], 'The hole must be 3D geometry'
    assert obj.ray_cast(Vector((-1.2,-1.2,3)),Vector((0,0,-1)))[0], 'Solid material must exist beside the hole'
    assert not obj.ray_cast(Vector((.9,.9,3)),Vector((0,0,-1)))[0], 'Stepped corner must remain absent'
    preview=json.loads((output/'preview.json').read_text())['meshes'][0]
    colors=np.array(preview['colors']).reshape(-1,3)
    assert len(preview['colors'])==len(preview['positions'])==len(preview['normals'])
    expected=linear_rgb(np.array([197,18,50])/255)
    assert np.min(np.linalg.norm(colors-expected,axis=1))<1e-5, 'Exact source color must survive linear conversion'
    assert np.any(np.all(colors>.8,axis=1)), 'White source detail must survive'
    attribute=obj.data.color_attributes['ForgeKitReferenceColor']
    assert len(attribute.data)==len(obj.data.vertices)
    assert len(preview['uvs']) == len(preview['positions'])//3*2
    assert all(0 <= n <= 1 for n in preview['uvs'])
    texture=preview['texture']
    assert texture['width']<=2048 and texture['height']<=2048
    packed=bpy.data.images[obj['ForgeKitTextureImage']]
    assert packed.packed_file and packed.colorspace_settings.name=='sRGB'
    assert base64.b64decode(texture['dataUrl'].split(',')[1]) == bytes(packed.packed_file.data)
    assert obj.data.uv_layers.get('ForgeKitReferenceUV')
    assert metrics['textureImagesPacked']==1
    shader=obj.data.materials[0].node_tree.nodes.get('Principled BSDF')
    assert shader.inputs['Base Color'].is_linked
    assert all(abs(a-b)<.005 for a,b in zip(sorted(obj.dimensions), sorted(size))), obj.dimensions[:]
    # Inspect projected detail without studio shading changing the source color.
    material=obj.data.materials[0]
    texture_node=next(n for n in material.node_tree.nodes if n.bl_idname=='ShaderNodeTexImage')
    assert shader.inputs['Base Color'].links[0].from_node == texture_node
    emission=material.node_tree.nodes.new('ShaderNodeEmission')
    material.node_tree.links.new(texture_node.outputs['Color'],emission.inputs['Color'])
    material.node_tree.links.new(emission.outputs[0],material.node_tree.nodes.get('Material Output').inputs['Surface'])
    scene=bpy.context.scene
    scene.view_settings.view_transform='Standard'
    scene.cycles.samples=1;scene.cycles.use_denoising=False
    scene.render.film_transparent=True
    scene.render.resolution_x=scene.render.resolution_y=256
    scene.render.image_settings.color_mode='RGBA'
    scores=[]
    for name,direction in [('front',(0,-1,0)),('right',(1,0,0)),('top',(0,0,1))]:
        scene.camera.location=Vector(direction)*20
        scene.camera.rotation_euler=(-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        scene.camera.data.ortho_scale=3.3
        scene.render.filepath=str(output/f'alpha-{name}.png')
        bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(scene.render.filepath,check_existing=False)
        pixels=np.empty(256*256*4,dtype=np.float32);image.pixels.foreach_get(pixels)
        pixels=pixels.reshape(256,256,4)[::-1]
        if name=='front':
            yellow=(pixels[...,0]>.9)&(pixels[...,1]>.5)&(pixels[...,1]<.85)&(pixels[...,2]<.1)&(pixels[...,3]>.9)
            assert yellow.sum()>40, 'Two-pixel reference stripe must survive actual textured render'
            stripe_pixels=int(yellow.sum())
        rows,columns=np.nonzero(pixels[...,3]>.5)
        actual=pixels[rows.min():rows.max()+1,columns.min():columns.max()+1,3]>.5
        target=next(v for v in originals if v['view']==name)['mask']
        def resize(mask):
            y=np.minimum((np.arange(96)+.5)*mask.shape[0]/96,mask.shape[0]-1).astype(int)
            x=np.minimum((np.arange(96)+.5)*mask.shape[1]/96,mask.shape[1]-1).astype(int)
            return mask[y[:,None],x[None,:]]
        a,t=resize(actual),resize(target)
        iou=float((a&t).sum()/(a|t).sum())
        assert iou>.94,(name,iou)
        scores.append(dict(view=name,renderedSilhouetteIou=round(iou,4),boxBaselineIou=round(float(t.mean()),4)))
        bpy.data.images.remove(image)
    report=dict(ok=True,fixture='orthographic stepped solid with through-hole',metrics=metrics,
                renderedScores=scores,sourceColorPreserved=True,packedUvTexture=True, renderedFineStripePixels=stripe_pixels,throughHolePreserved=True,manifold=True,
                explicitRejections=negative,externalProviderTested=False,studioUploadTested=False,
                generalPhotoFidelityCertified=False)
    (output/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
    print('FORGEKIT_RECONSTRUCTION_ACCEPTANCE '+json.dumps(report))


if __name__=='__main__':
    main(Path(sys.argv[sys.argv.index('--')+1]).resolve())
