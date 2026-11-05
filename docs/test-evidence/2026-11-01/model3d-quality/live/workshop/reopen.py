import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
folder=Path(sys.argv[sys.argv.index('--')+1]);recipe=json.loads((folder/'recipe.json').read_text());report={}
for kind in ['blend','glb','fbx']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 if kind=='blend':bpy.ops.wm.open_mainfile(filepath=str(folder/'model.blend'))
 elif kind=='glb':bpy.ops.import_scene.gltf(filepath=str(folder/'model.glb'))
 else:bpy.ops.import_scene.fbx(filepath=str(folder/'model.fbx'))
 bpy.context.view_layer.update();objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
 assert len(objects)==len(recipe['parts']),(kind,len(objects))
 for part in recipe['parts']:
  obj=next(o for o in objects if o.name==part['name'])
  assert all(math.isfinite(c) for v in obj.data.vertices for c in v.co)
  assert all(math.isfinite(c) for p in obj.data.polygons for c in p.normal)
  actual=sorted(obj.dimensions);expected=sorted(part['size'])
  assert all(abs(a-b)<max(1e-5,b*1e-4) for a,b in zip(actual,expected)),(kind,part['id'],actual,expected)
 if kind=='blend':
  hook=next(o for o in objects if o.name=='profile-hook')
  assert not hook.ray_cast(Vector((0,0,-1)),Vector((0,0,1)))[0]
  assert hook.ray_cast(Vector((.2,0,-1)),Vector((0,0,1)))[0]
  body=next(o for o in objects if o.name=='toolbox');assert len(body.data.polygons)>6
  cylinder=next(o for o in objects if o.name=='glass-canister');assert any(p.use_smooth for p in cylinder.data.polygons)
 report[kind]={'meshCount':len(objects),'finiteVertices':True,'finiteNormals':True,'dimensionsMatch':True}
(folder/'reopened.json').write_text(json.dumps(report,indent=2))
