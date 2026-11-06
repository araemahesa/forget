"""Trusted GLB editor: validated data only, no generated code or external resources."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, str(Path(__file__).parent))
from blender_build import build

CONVERSION = Matrix.Rotation(math.pi / 2, 4, 'X')


def imported(source, allowed_additions=None):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH']
    if not meshes or len(meshes) > 256:
        raise ValueError('Model must contain 1..256 mesh objects')
    if any(o.type == 'ARMATURE' or o.animation_data for o in bpy.context.scene.objects if o not in before) or any(o.data.shape_keys for o in meshes):
        raise ValueError('Animated, rigged, and morph-target GLBs are not supported by this editor')
    ids = set()
    for index, obj in enumerate(meshes):
        key = obj.get('ForgeKitEditId', f'source_{index}')
        if not isinstance(key, str) or not key or len(key) > 80 or key in ids:
            raise ValueError('Invalid or duplicate object ID')
        obj['ForgeKitEditId'] = key
        if allowed_additions is not None:
            # A GPU GLB cannot grant itself deletion rights through custom extras.
            obj['ForgeKitAddition'] = key in allowed_additions
        ids.add(key)
    return meshes


def bounds(objects):
    bpy.context.view_layer.update()
    points = [CONVERSION.inverted() @ obj.matrix_world @ Vector(v) for obj in objects for v in obj.bound_box]
    return {'min': [min(p[i] for p in points) for i in range(3)],
            'max': [max(p[i] for p in points) for i in range(3)]}


def inventory(objects):
    result = []
    triangles = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        result.append({'id': obj['ForgeKitEditId'], 'name': obj.name[:120],
                       'addition': obj.get('ForgeKitAddition') is True,
                       'vertices': len(obj.data.vertices), 'bounds': bounds([obj]),
                       'materials': [m.name[:120] for m in obj.data.materials if m]})
    if triangles > 2000000:
        raise ValueError('Source exceeds 2000000 triangles')
    return {'objects': result, 'bounds': bounds(objects), 'triangles': triangles,
            'coordinates': 'Y-up, recipe/model units; position is world-space translation delta'}


def material_edit(obj, operation):
    # Isolate shared materials and mesh slots; unrelated objects and texture nodes stay untouched.
    obj.data = obj.data.copy()
    if not obj.data.materials:
        obj.data.materials.append(bpy.data.materials.new('Edited material'))
    for index, current in enumerate(list(obj.data.materials)):
        material = current.copy() if current else bpy.data.materials.new('Edited material')
        obj.data.materials[index] = material
        material.use_nodes = True
        shader = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if shader is None:
            raise ValueError('Material has no supported Principled shader')
        if operation.get('color') is not None:
            color = operation['color']
            rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
            linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
            socket = shader.inputs['Base Color']
            for link in list(socket.links):
                material.node_tree.links.remove(link)
            socket.default_value = (*linear, 1)
            material.diffuse_color = (*linear, material.diffuse_color[3])
        for field, socket_name in [('roughness', 'Roughness'), ('metalness', 'Metallic')]:
            if operation.get(field) is not None:
                socket = shader.inputs[socket_name]
                for link in list(socket.links):
                    material.node_tree.links.remove(link)
                socket.default_value = operation[field]


def edit(source, destination, plan_path):
    plan = json.loads(plan_path.read_text())
    added = []
    if plan.get('additions') is not None:
        added = build(plan['additions'], destination, finalize=False)
        for obj in added:
            obj['ForgeKitEditId'] = 'addition_' + obj['ForgeKitPartId']
            obj['ForgeKitAddition'] = True
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    allowed_additions = json.loads((destination / 'allowed-additions.json').read_text())
    original = imported(source, allowed_additions)
    meshes = original + added
    if len({o['ForgeKitEditId'] for o in meshes}) != len(meshes):
        raise ValueError('Addition ID already exists')
    for operation in plan['operations']:
        targets = meshes[:] if operation['target'] == '*' else [o for o in meshes if o['ForgeKitEditId'] == operation['target']]
        if not targets:
            raise ValueError('Edit target missing')
        if operation['op'] == 'remove':
            if any(o.get('ForgeKitAddition') is not True for o in targets):
                raise ValueError('Only tagged additions can be removed; source geometry protected')
            for obj in targets:
                meshes.remove(obj)
                bpy.data.objects.remove(obj, do_unlink=True)
        elif operation['op'] == 'material':
            for obj in targets:
                material_edit(obj, operation)
        elif operation['op'] == 'transform':
            box = bounds(targets)
            center = Vector([(a + b) / 2 for a, b in zip(box['min'], box['max'])])
            rotation = operation.get('rotation') or [0, 0, 0]
            scale = operation.get('scale') or [1, 1, 1]
            translation = Vector(operation.get('position') or [0, 0, 0])
            transform = Matrix.Translation(center + translation)
            for axis, degrees in zip('XYZ', rotation):
                transform = transform @ Matrix.Rotation(math.radians(degrees), 4, axis)
            transform = transform @ Matrix.Diagonal((*scale, 1)) @ Matrix.Translation(-center)
            transform = CONVERSION @ transform @ CONVERSION.inverted()
            # Snapshot world transforms before assignment, so parent chains are not transformed twice.
            worlds = [(obj, transform @ obj.matrix_world.copy()) for obj in targets]
            def depth(obj):
                level = 0
                while obj.parent:
                    level += 1
                    obj = obj.parent
                return level
            for obj, world in sorted(worlds, key=lambda item: depth(item[0])):
                obj.matrix_world = world
        else:
            raise ValueError('Unsupported operation')
    expected = inventory(meshes)
    bpy.ops.object.select_all(action='DESELECT')
    # Include ancestors so imported hierarchy stays intact. Export only edited model, no factory camera/light.
    for obj in meshes:
        obj.select_set(True)
        parent = obj.parent
        while parent:
            parent.select_set(True)
            parent = parent.parent
    bpy.ops.file.pack_all()
    bpy.ops.export_scene.gltf(filepath=str(destination / 'model.glb'), export_format='GLB',
                              use_selection=True, export_extras=True, export_animations=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    reopened = imported(destination / 'model.glb')
    actual = inventory(reopened)
    if {o['id'] for o in expected['objects']} != {o['id'] for o in actual['objects']}:
        raise ValueError('Export/reimport object IDs changed')
    if sum(o['vertices'] for o in actual['objects']) <= 0:
        raise ValueError('Export/reimport geometry empty')
    actual['reimported'] = True
    (destination / 'result.json').write_text(json.dumps(actual))


if __name__ == '__main__':
    mode, source, destination, *rest = sys.argv[sys.argv.index('--') + 1:]
    source, destination = Path(source), Path(destination)
    if mode == 'inspect':
        bpy.ops.wm.read_factory_settings(use_empty=True)
        (destination / 'inventory.json').write_text(json.dumps(inventory(imported(source, json.loads((destination / 'allowed-additions.json').read_text())))))
    elif mode == 'edit':
        edit(source, destination, Path(rest[0]))
    else:
        raise ValueError('Unknown editor mode')
