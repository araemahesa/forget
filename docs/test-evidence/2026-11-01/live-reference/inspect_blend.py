"""Read-only inspection of the real provider result, run with Blender --disable-autoexec."""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy


def inspect():
    rows = []
    for obj in bpy.data.objects:
        if not obj.get('ForgeKitPartId'):
            continue
        assert obj.type == 'MESH'
        obj.data.calc_loop_triangles()
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        manifold = all(edge.is_manifold for edge in bm.edges)
        bm.free()
        rows.append({
            'id': obj['ForgeKitPartId'],
            'name': obj.name,
            'vertices': len(obj.data.vertices),
            'faces': len(obj.data.polygons),
            'triangles': len(obj.data.loop_triangles),
            'manifold': manifold,
            'dimensions': list(obj.dimensions),
            'finite': all(math.isfinite(v) for vertex in obj.data.vertices for v in vertex.co),
            'materials': [slot.material.name for slot in obj.material_slots if slot.material],
        })
    scene = bpy.context.scene
    packed = [image.name for image in bpy.data.images if image.packed_file]
    result = {
        'file': bpy.data.filepath,
        'objects': rows,
        'packedReferences': packed,
        'camera': scene.camera.name if scene.camera else None,
        'lights': len([obj for obj in scene.objects if obj.type == 'LIGHT']),
        'resolution': [scene.render.resolution_x, scene.render.resolution_y],
        'samples': scene.cycles.samples,
        'autoexecEnabled': bpy.context.preferences.filepaths.use_scripts_auto_execute,
    }
    assert len(rows) == 2 and len(packed) == 3
    assert all(row['manifold'] and row['finite'] for row in rows)
    assert sorted(row['vertices'] for row in rows)[0] == 5, 'Corrected pyramid requires a four-corner base and one apex'
    assert result['resolution'] == [1920, 1920] and result['samples'] == 128
    assert result['camera'] and result['lights'] == 3
    assert not result['autoexecEnabled']
    destination = Path(sys.argv[sys.argv.index('--') + 1])
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))


inspect()
