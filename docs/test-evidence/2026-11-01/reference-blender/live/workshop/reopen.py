import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
folder=Path(sys.argv[sys.argv.index('--')+1]);recipe=json.loads((folder/'recipe.json').read_text());presets=json.loads((folder/'model3d-materials.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(folder/'model.blend'),load_ui=False,use_scripts=False)
objects=[o for o in bpy.data.objects if o.get('ForgeKitPartId')];assert len(objects)==len(recipe['parts'])
for part in recipe['parts']:
 obj=next(o for o in objects if o['ForgeKitPartId']==part['id']);actual=sorted(obj.dimensions);expected=sorted(part['size'])
 assert all(abs(a-b)<max(1e-5,b*1e-4) for a,b in zip(actual,expected)),(part['id'],actual,expected)
 shader=obj.data.materials[0].node_tree.nodes.get('Principled BSDF');surface={k:part.get(k,v) for k,v in presets[part['material']].items()}
 for name,key in [('Metallic','metalness'),('Roughness','roughness'),('Alpha','opacity'),('Emission Strength','emissiveIntensity')]:assert abs(shader.inputs[name].default_value-surface[key])<1e-5,(part['id'],name)
 rgb=[int(part['color'][i:i+2],16)/255 for i in (1,3,5)];linear=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
 assert all(abs(a-b)<1e-5 for a,b in zip(shader.inputs['Base Color'].default_value[:3],linear)),part['id']
 assert all(math.isfinite(c) for v in obj.data.vertices for c in v.co)
hook=next(o for o in objects if o.name=='profile-hook')
assert not hook.ray_cast(Vector((0,0,-1)),Vector((0,0,1)))[0]
assert hook.ray_cast(Vector((.2,0,-1)),Vector((0,0,1)))[0]
(folder/'reopened.json').write_text(json.dumps({'blend':True,'dimensions':True,'materialValues':True,'openingPreserved':True}))
