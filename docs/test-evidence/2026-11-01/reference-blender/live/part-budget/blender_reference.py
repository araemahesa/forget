"""Trusted Blender workspace, internal mesh preview and material renders. No user code."""
import base64
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def finish(recipe, output, objects, conversion):
    meshes = []
    inverse = conversion.inverted()
    for obj, part in zip(objects, recipe['parts']):
        obj.data.calc_loop_triangles()
        positions, normals = [], []
        transform = inverse @ obj.matrix_world
        normal_matrix = transform.to_3x3().inverted().transposed()
        for tri in obj.data.loop_triangles:
            for vertex_index, loop_index in zip(tri.vertices, tri.loops):
                positions.extend(round(float(c), 7) for c in transform @ obj.data.vertices[vertex_index].co)
                normals.extend(round(float(c), 7) for c in (normal_matrix @ obj.data.corner_normals[loop_index].vector).normalized())
        meshes.append({'id': part['id'], 'name': part['name'], 'positions': positions, 'normals': normals,
                       'color': part['color'], 'material': part['material'],
                       **{key: part[key] for key in ('roughness', 'metalness', 'opacity', 'emissiveIntensity') if key in part}})
    (output / 'preview.json').write_text(json.dumps({'schemaVersion': 1, 'name': recipe['name'], 'meshes': meshes}, separators=(',', ':'), allow_nan=False))
    model = bpy.data.collections.new('ForgeKit Model')
    bpy.context.scene.collection.children.link(model)
    for obj in objects:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        model.objects.link(obj)
    references = json.loads((output / 'references.json').read_text())
    reference_collection = bpy.data.collections.new('ForgeKit References')
    bpy.context.scene.collection.children.link(reference_collection)
    packed = []
    for index, reference in enumerate(references):
        data = base64.b64decode(reference['dataUrl'].removeprefix('data:image/png;base64,'), validate=True)
        path = output / f'reference-{index}.png'
        path.write_bytes(data)
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = f"Reference {index+1}: {reference['name']}"
        image.pack()
        image.filepath = f'//ForgeKitReferences/reference-{index}.png'
        obj = bpy.data.objects.new(image.name, None)
        obj.empty_display_type = 'IMAGE'
        obj.data = image
        obj.hide_render = True
        reference_collection.objects.link(obj)
        obj.hide_set(True)
        packed.append(image.name)
    scene = bpy.context.scene
    scene['ForgeKitReferenceCount'] = len(packed)
    scene['ForgeKitVisualSimilarity'] = 'unverified'
    notes = bpy.data.texts.new('ForgeKit Reference Notes')
    notes.write('Editable model generated from validated geometry data.\nReference images are packed under ForgeKit References and hidden from renders.\nCompare shape, volume, proportions, openings, every distinctive detail, palette and material response.\nUnseen surfaces are interpretation. No 100% likeness, UV, rig or gameplay certification.\n')
    notes.write('\n'.join(packed))
    bounds = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    low = Vector(tuple(min(p[i] for p in bounds) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in bounds) for i in range(3)))
    center = (low + high) / 2
    extent = max(high - low)
    scene.world = bpy.data.worlds.new('ForgeKit neutral studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.3, .3, .3, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .4
    studio = bpy.data.collections.new('ForgeKit Inspection Studio')
    scene.collection.children.link(studio)
    for index, (direction, power) in enumerate([((1,-1,2),120),((-1,-.5,1),90),((.5,1,1.5),150)]):
        data = bpy.data.lights.new(f'Studio softbox {index}', 'AREA')
        data.energy = power * extent * extent
        data.size = extent * 1.5
        lamp = bpy.data.objects.new(data.name, data)
        studio.objects.link(lamp)
        lamp.location = center + Vector(direction) * extent
        lamp.rotation_euler = (center-lamp.location).to_track_quat('-Z','Y').to_euler()
    camera_data = bpy.data.cameras.new('ForgeKit Inspection Camera')
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    studio.objects.link(camera)
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = (high-low).length * 1.25
    camera_data.clip_start = max(extent / 10000, .00001)
    camera_data.clip_end = max(extent * 30, 1)
    scene.camera = camera
    directions = [('perspective',(1,-1,.7)), ('front',(0,-1,0)), ('right',(1,0,0))]
    def pose(direction):
        camera.location = center + Vector(direction).normalized() * extent * 4
        camera.rotation_euler = (center-camera.location).to_track_quat('-Z','Y').to_euler()
    pose(directions[0][1])
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.region_3d.view_location = center
                space.region_3d.view_distance = extent * 2
                space.clip_start = camera_data.clip_start
                space.clip_end = camera_data.clip_end
                space.shading.type = 'MATERIAL'
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.time_limit = 15
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 448
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'AgX'
    views = []
    if references:
        for name, direction in directions:
            pose(direction)
            scene.render.filepath = str(output / f'view-{name}.png')
            bpy.ops.render.render(write_still=True)
            views.append(name)
    pose(directions[0][1])
    scene.render.filepath = '//ForgeKit-Render.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'model.blend'), compress=False)
    # Reopen only our just-generated scene, with scripts disabled, before admitting the file.
    bpy.ops.wm.open_mainfile(filepath=str(output / 'model.blend'), load_ui=False, use_scripts=False)
    assert len([o for o in bpy.data.objects if o.get('ForgeKitPartId')]) == len(objects)
    assert len([image for image in bpy.data.images if image.packed_file]) == len(packed)
    return {'referenceImagesPacked': len(packed), 'views': views, 'blendReopened': True}
