"""Fixed geometry-only attachment inspector. Never run embedded scripts or load textures."""
import bpy, sys, math
from pathlib import Path
from mathutils import Vector
source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = source.suffix.lower()
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
elif ext == '.glb':
    bpy.ops.import_scene.gltf(filepath=str(source))
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=str(source))
elif ext == '.stl':
    bpy.ops.wm.stl_import(filepath=str(source))
elif ext == '.ply':
    bpy.ops.wm.ply_import(filepath=str(source))
else:
    raise ValueError('Unsupported model')
objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not objects or len(objects) > 2000 or sum(len(obj.data.vertices) for obj in objects) > 1000000:
    raise ValueError('Model empty or too complex')
# Clear animation, handlers, modifiers and nonmesh objects before a fixed workbench render.
bpy.app.handlers.frame_change_pre.clear()
bpy.app.handlers.frame_change_post.clear()
for obj in list(bpy.context.scene.objects):
    if obj not in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
for obj in objects:
    obj.animation_data_clear()
    obj.modifiers.clear()
    obj.hide_render = False
    obj.hide_set(False)
    obj.color = (0.48, 0.68, 0.8, 1)
points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (low + high) / 2
extent = max(high - low)
if not math.isfinite(extent) or extent <= 0:
    raise ValueError('Invalid geometry')
(output / 'model.txt').write_text(f'Geometry inspection: {len(objects)} mesh objects, {sum(len(o.data.vertices) for o in objects)} vertices. Bounding box XYZ: {tuple(high-low)}. Original format {ext}. Views show geometry only; textures, rig and animation are not verified.', encoding='utf-8')
scene = bpy.context.scene
scene.animation_data_clear()
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'OBJECT'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'
scene.world = bpy.data.worlds.new('AttachmentWorld')
scene.world.color = (0.08, 0.08, 0.10)
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.use_file_extension = True
camera_data = bpy.data.cameras.new('AttachmentCamera')
camera = bpy.data.objects.new('AttachmentCamera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = extent * 1.9
camera_data.clip_end = max(1000, extent * 20)
for index, direction in enumerate([(1,-1,.7), (0,-1,0), (1,0,0)]):
    camera.location = center + Vector(direction).normalized() * extent * 4
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(output / f'view-{index}.png')
    bpy.ops.render.render(write_still=True)
