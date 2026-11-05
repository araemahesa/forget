"""Trusted ForgeKit builder. Input is validated data, never model-generated Python."""
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector
sys.path.insert(0, str(Path(__file__).parent))
from blender_reference import finish
from blender_reconstruction import reconstruct

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
        if primitive == 'reconstruction':
            obj = reconstruct(part, output, 200000-triangles)
        elif primitive == 'mesh':
            mesh = bpy.data.meshes.new(part['id'])
            faces = [tri for face in part['mesh']['faces'] for tri in ([face] if len(face) == 3 else [[face[0],face[1],face[2]],[face[0],face[2],face[3]]])]
            mesh.from_pydata(part['mesh']['vertices'], [], part['mesh']['faces'] if part.get('subdivision', 0) else faces)
            mesh.update()
            obj = bpy.data.objects.new(part['id'], mesh)
            bpy.context.collection.objects.link(obj)
        elif primitive == 'lathe':
            points, faces, rings = [], [], []
            for radius, y in part['lathe']['points']:
                ring = []
                for index in range(segments if radius > 1e-9 else 1):
                    angle = 2 * math.pi * index / segments
                    ring.append(len(points))
                    points.append((radius * math.sin(angle), y, radius * math.cos(angle)))
                rings.append(ring)
            for a, b in zip(rings, rings[1:]):
                for index in range(segments):
                    i, j = index % len(a), (index + 1) % len(a)
                    k, l = index % len(b), (index + 1) % len(b)
                    if a[i] != a[j]: faces.append((a[i],b[k],a[j]))
                    if b[k] != b[l]: faces.append((a[j],b[k],b[l]))
            mesh = bpy.data.meshes.new(part['id'])
            mesh.from_pydata(points, [], faces)
            mesh.update()
            obj = bpy.data.objects.new(part['id'], mesh)
            bpy.context.collection.objects.link(obj)
        elif primitive == 'profile':
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
        if primitive in ('mesh', 'lathe', 'wedge'):
            topology = bmesh.new()
            topology.from_mesh(obj.data)
            bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
            if all(edge.is_manifold for edge in topology.edges) and topology.calc_volume(signed=True) < 0:
                bmesh.ops.reverse_faces(topology, faces=list(topology.faces))
            topology.to_mesh(obj.data)
            topology.free()
            obj.data.update()
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
        smooth = part.get('smooth', primitive in ('sphere', 'cylinder', 'cone', 'torus', 'mesh', 'lathe', 'reconstruction') or bevel > 0)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if bevel > 0:
            modifier = obj.modifiers.new('ForgeKit edge radius', 'BEVEL')
            modifier.width = bevel
            modifier.segments = 3
            modifier.use_clamp_overlap = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        subdivision = part.get('subdivision', 0)
        if subdivision:
            projected_triangles = sum(len(face.vertices) for face in obj.data.polygons) * 2 * 4 ** (subdivision - 1)
            if triangles + projected_triangles > 200000:
                raise ValueError('Subdivision exceeds triangle budget before evaluation')
            modifier = obj.modifiers.new('ForgeKit organic surface', 'SUBSURF')
            modifier.subdivision_type = 'CATMULL_CLARK'
            modifier.levels = subdivision
            modifier.render_levels = subdivision
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
        material_key = (part['color'].lower(), obj.get('ForgeKitTextureImage', ''), *surface.values())
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
            if primitive == 'reconstruction':
                texture = material.node_tree.nodes.new('ShaderNodeTexImage')
                texture.image = bpy.data.images[obj['ForgeKitTextureImage']]
                texture.interpolation = 'Linear'
                texture.extension = 'EXTEND'
                material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
                material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Emission Color'])
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
    # All saved model objects use the same validated geometry and material values.
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.context.view_layer.update()
    positions = []
    for obj in objects:
        positions.extend(conversion.inverted() @ obj.matrix_world @ v.co for v in obj.data.vertices)
    minimum = [min(p[i] for p in positions) for i in range(3)]
    maximum = [max(p[i] for p in positions) for i in range(3)]
    metrics = {'blenderVersion': bpy.app.version_string, 'parts': len(objects), 'materials': len(material_cache), 'vertices': vertices, 'triangles': triangles, 'bounds': {'min': minimum, 'max': maximum}}
    metrics['reconstructions'] = [dict(partId=obj['ForgeKitPartId'], **json.loads(obj['ForgeKitReconstruction'])) for obj in objects if obj.get('ForgeKitReconstruction')]
    metrics.update(finish(recipe, output, objects, conversion))
    (output / 'metrics.json').write_text(json.dumps(metrics))


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    recipe_path, destination = map(Path, args)
    build(json.loads(recipe_path.read_text()), destination)
