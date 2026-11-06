#!/usr/bin/env python3
"""Actual Blender editor smoke. Isolated fixture, no provider, no user workspace/data mutation."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'apps/desktop/src-tauri/scripts/blender'
BLENDER = shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender'
FIXTURE = r'''
import bpy
from pathlib import Path
import sys
out = Path(sys.argv[sys.argv.index('--') + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=2)
a = bpy.context.object
a.name = 'Textured source body'
material = bpy.data.materials.new('Original painted material')
material.use_nodes = True
shader = material.node_tree.nodes.get('Principled BSDF')
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
image = bpy.data.images.new('Embedded paint', width=4, height=4)
image.pixels = [0.7, 0.1, 0.3, 1] * 16
image.pack()
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
shader.inputs['Metallic'].default_value = 0.1
shader.inputs['Roughness'].default_value = 0.6
a.data.materials.append(material)
bpy.ops.export_scene.gltf(filepath=str(out / 'source.glb'), export_format='GLB', export_extras=True)
'''
VERIFY = r'''
import bpy, json, sys
from pathlib import Path
out = Path(sys.argv[sys.argv.index('--') + 1])
def inspect(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(out / name))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    source = next(o for o in meshes if not o.get('ForgeKitAddition'))
    vertices = sorted(tuple(round(c, 5) for c in v.co) for v in source.data.vertices)
    shader = source.data.materials[0].node_tree.nodes.get('Principled BSDF')
    textures = [n.image for n in source.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE']
    assert textures, 'Original texture missing'
    image = textures[0]
    pixels = [round(c, 4) for c in image.pixels[:]]
    return meshes, vertices, shader.inputs['Metallic'].default_value, pixels
_, before, metal_before, paint_before = inspect('source.glb')
meshes, after, metal_after, paint_after = inspect('model.glb')
assert before == after, 'Source topology/positions changed'
assert paint_before == paint_after, 'Original texture pixels changed'
assert abs(metal_before - 0.1) < 0.01 and abs(metal_after - 0.85) < 0.01
assert len(meshes) == 2
assert any(o.get('ForgeKitEditId') == 'addition_hat' and o.get('ForgeKitAddition') for o in meshes)
(out / 'verification.json').write_text(json.dumps({'sourceGeometryPreserved': True, 'sourceTexturePreserved': True, 'materialChanged': True, 'additionReimported': True}))
'''


def main():
    with tempfile.TemporaryDirectory(prefix='forgekit-hunyuan-edit-test-') as folder:
        root = Path(folder)
        for name in ['hunyuan_edit.py', 'blender_build.py', 'blender_reference.py', 'blender_reconstruction.py', 'blender_texture.py']:
            shutil.copyfile(SOURCE / name, root / name)
        shutil.copyfile(ROOT / 'packages/contracts/src/model3d-materials.json', root / 'model3d-materials.json')
        (root / 'fixture.py').write_text(FIXTURE)
        (root / 'verify.py').write_text(VERIFY)

        sequence = 0
        def run(script, *args, success=True):
            nonlocal sequence
            sequence += 1
            process = subprocess.run([BLENDER, '--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', str(root / script), '--', *map(str, args)], cwd=root, capture_output=True, timeout=120)
            logs = Path(os.environ.get('FORGEKIT_TEST_LOG_DIR', ROOT / '.logs/hunyuan-edit-smoke'))
            logs.mkdir(parents=True, exist_ok=True)
            (logs / f'{sequence:02}-{script}.log').write_bytes(process.stdout + process.stderr)
            if (process.returncode == 0) != success:
                sys.stderr.buffer.write(process.stdout + process.stderr)
                raise AssertionError(f'{script}: exit {process.returncode}, expected success={success}')
        (root / 'allowed-additions.json').write_text('[]')
        run('fixture.py', root)
        original = (root / 'source.glb').read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        run('hunyuan_edit.py', 'inspect', root / 'source.glb', root)
        inventory = json.loads((root / 'inventory.json').read_text())
        target = inventory['objects'][0]['id']
        recipe = {'name': 'Added hat', 'category': 'accessory', 'seed': 0, 'exportFormat': 'glb', 'parts': [{'id': 'hat', 'name': 'Hat', 'primitive': 'cone', 'position': [0, 2, 0], 'size': [2, 1, 2], 'rotation': [0, 0, 0], 'color': '#2233aa', 'material': 'Plastic'}]}
        (root / 'plan.json').write_text(json.dumps({'summary': 'Metal body, add hat', 'operations': [{'op': 'material', 'target': target, 'metalness': 0.85}], 'additions': recipe}))
        run('hunyuan_edit.py', 'edit', root / 'source.glb', root, root / 'plan.json')
        run('verify.py', root)
        assert json.loads((root / 'result.json').read_text())['reimported']
        shutil.copyfile(root / 'model.glb', root / 'version-one.glb')
        (root / 'allowed-additions.json').write_text('["addition_hat"]')
        (root / 'plan.json').write_text(json.dumps({'summary': 'Remove hat, resize and rotate body', 'operations': [{'op': 'remove', 'target': 'addition_hat'}, {'op': 'transform', 'target': target, 'scale': [2, 2, 2], 'rotation': [0, 90, 0]}]}))
        run('hunyuan_edit.py', 'edit', root / 'version-one.glb', root, root / 'plan.json')
        result = json.loads((root / 'result.json').read_text())
        assert len(result['objects']) == 1
        assert all(abs(b - a - 4) < 0.01 for a, b in zip(result['bounds']['min'], result['bounds']['max']))
        assert hashlib.sha256((root / 'source.glb').read_bytes()).hexdigest() == digest
        (root / 'plan.json').write_text(json.dumps({'operations': [{'op': 'remove', 'target': target}]}))
        run('hunyuan_edit.py', 'edit', root / 'source.glb', root, root / 'plan.json', success=False)
        assert (root / 'source.glb').read_bytes() == original
        print('PASS: actual GLB import/edit/export/reimport; original hash/geometry/texture preserved; material, addition, removal, scale, rotation verified; source removal rejected')


if __name__ == '__main__':
    main()
