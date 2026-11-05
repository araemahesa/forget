"""Trusted ForgeKit builder. Input is validated data, never model-generated Python."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

MATERIALS = json.loads(Path(__file__).with_name('model3d-materials.json').read_text())


def ring_area(points):
    return sum(p[0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * p[1] for i, p in enumerate(points))


def build(recipe, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    conversion = Matrix.Rotation(math.pi / 2, 4, 'X')
    objects = []
    triangles = vertices = 0
    material_cache = {}
    for part in recipe['parts']:
        primitive = part['primitive']
        segments = part.get('segments', 48 if primitive == 'torus' else 32)
        if primitive == 'profile':
            profile = part['profile']
            curve = bpy.data.curves.new(part['id'], 'CURVE')
            curve.dimensions = '2D'
            curve.fill_mode = 'BOTH'
            curve.extrude = .5
            curve.bevel_depth = profile['bevel']
            curve.bevel_resolution = 3
            for index, points in enumerate([profile['outline'], *profile['holes']]):
                points = list(points)
                if (ring_area(points) > 0) != (index == 0):
                    points.reverse()
                spline = curve.splines.new('POLY')
                spline.points.add(len(points) - 1)
                for point, xy in zip(spline.points, points):
                    point.co = (*xy, 0, 1)
                spline.use_cyclic_u = True
            obj = bpy.data.objects.new(part['id'], curve)
            bpy.context.collection.objects.link(obj)
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.convert(target='MESH')
            obj = bpy.context.object
        elif primitive == 'wedge':
            mesh = bpy.data.meshes.new(part['id'])
            mesh.from_pydata([(-.5,-.5,-.5),(.5,-.5,-.5),(.5,-.5,.5),(-.5,-.5,.5),(-.5,.5,-.5),(.5,.5,-.5)], [], [(0,3,2,1),(0,1,5,4),(3,4,5,2),(0,4,3),(1,2,5)])
            mesh.update()
            obj = bpy.data.objects.new(part['id'], mesh)
            bpy.context.collection.objects.link(obj)
        else:
            if primitive == 'cube':
                bpy.ops.mesh.primitive_cube_add(size=1)
            elif primitive == 'sphere':
                bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(4, segments // 2), radius=.5)
            elif primitive in ('cone', 'cylinder'):
                bpy.ops.mesh.primitive_cone_add(vertices=segments, radius1=.5, radius2=0 if primitive == 'cone' else .5, depth=1)
            elif primitive == 'torus':
                bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=max(4, segments // 4), major_radius=.38, minor_radius=.12)
            else:
                raise ValueError('Unsupported primitive')
            obj = bpy.context.object
            # Primitives are authored along recipe Y, before converting the whole scene to Blender Z-up.
            if primitive in ('cone', 'cylinder'):
                rotation = Matrix.Rotation(-math.pi / 2, 4, 'X')
                for vertex in obj.data.vertices:
                    vertex.co = rotation @ vertex.co
        obj.name = part['name']
        obj['ForgeKitPartId'] = part['id']
        points = obj.data.vertices
        minimum = Vector(tuple(min(v.co[i] for v in points) for i in range(3)))
        maximum = Vector(tuple(max(v.co[i] for v in points) for i in range(3)))
        center = (minimum + maximum) / 2
        extent = maximum - minimum
        if min(extent) < 1e-8:
            raise ValueError('Profile produced empty or degenerate geometry')
        for vertex in points:
            vertex.co = Vector(tuple((vertex.co[i] - center[i]) / extent[i] * part['size'][i] for i in range(3)))
        bevel = part.get('bevel', 0)
        smooth = part.get('smooth', primitive in ('sphere', 'cylinder', 'cone', 'torus') or bevel > 0)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if bevel > 0:
            modifier = obj.modifiers.new('ForgeKit edge radius', 'BEVEL')
            modifier.width = bevel
            modifier.segments = 3
            modifier.use_clamp_overlap = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        for polygon in obj.data.polygons:
            # Flat caps keep cylinders readable; rounded side walls use smooth normals.
            polygon.use_smooth = smooth and (primitive not in ('cone', 'cylinder') or abs(polygon.normal.y) < .99)
        if primitive == 'cube' and bevel > 0 and smooth:
            modifier = obj.modifiers.new('ForgeKit face normals', 'WEIGHTED_NORMAL')
            modifier.keep_sharp = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        x, y, z = map(math.radians, part['rotation'])
        obj.matrix_world = conversion @ Matrix.Translation(Vector(part['position'])) @ Matrix.Rotation(x, 4, 'X') @ Matrix.Rotation(y, 4, 'Y') @ Matrix.Rotation(z, 4, 'Z')
        surface = {key: part.get(key, value) for key, value in MATERIALS[part['material']].items()}
        material_key = (part['color'].lower(), *surface.values())
        material = material_cache.get(material_key)
        if material is None:
            material = bpy.data.materials.new(f"{part['material']}_{part['color'][1:]}")
            material.use_nodes = True
            material.use_backface_culling = True
            rgb = [int(part['color'][i:i+2], 16) / 255 for i in (1,3,5)]
            linear = tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb)
            shader = material.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = (*linear, 1)
            shader.inputs['Metallic'].default_value = surface['metalness']
            shader.inputs['Roughness'].default_value = surface['roughness']
            shader.inputs['Emission Color'].default_value = (*linear, 1)
            shader.inputs['Emission Strength'].default_value = surface['emissiveIntensity']
            shader.inputs['Alpha'].default_value = surface['opacity']
            if surface['opacity'] < 1:
                material.surface_render_method = 'DITHERED'
            material.diffuse_color = (*linear, surface['opacity'])
            material_cache[material_key] = material
        obj.data.materials.append(material)
        objects.append(obj)
        obj.data.update()
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        vertices += len(obj.data.vertices)
        if triangles > 200000:
            raise ValueError('Generated geometry exceeds 200000 triangles; reduce hidden detail or radial segments')
        if not obj.data.polygons or any(not math.isfinite(c) for v in obj.data.vertices for c in v.co):
            raise ValueError('Generated geometry is empty or non-finite')
        bpy.ops.object.select_all(action='DESELECT')
    # All exports contain the same selected mesh objects, with baked transforms/modifiers.
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.context.view_layer.update()
    positions = []
    for obj in objects:
        positions.extend(conversion.inverted() @ obj.matrix_world @ v.co for v in obj.data.vertices)
    minimum = [min(p[i] for p in positions) for i in range(3)]
    maximum = [max(p[i] for p in positions) for i in range(3)]
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'model.blend'), compress=False)
    bpy.ops.export_scene.gltf(filepath=str(output / 'model.glb'), export_format='GLB', use_selection=True, export_yup=True)
    bpy.ops.export_scene.fbx(filepath=str(output / 'model.fbx'), use_selection=True, object_types={'MESH'}, add_leaf_bones=False, axis_forward='-Z', axis_up='Y', bake_anim=False)
    (output / 'metrics.json').write_text(json.dumps({'blenderVersion': bpy.app.version_string, 'parts': len(objects), 'materials': len(material_cache), 'vertices': vertices, 'triangles': triangles, 'bounds': {'min': minimum, 'max': maximum}}))


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    recipe_path, destination = map(Path, args)
    build(json.loads(recipe_path.read_text()), destination)
