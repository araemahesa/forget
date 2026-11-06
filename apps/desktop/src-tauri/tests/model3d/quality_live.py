"""Opt-in integration: actual Blender files, isolated fixtures, no provider or Studio writes."""
from pathlib import Path
import argparse, json, math, shutil, struct, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[5]
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'

def part(id, primitive='cube', position=(0,0,0), size=(1,1,1), color='#246bb3', material='Metal', **fields):
    return dict(id=id, name=id, primitive=primitive, position=list(position), size=list(size), rotation=[0,0,0], color=color, material=material, **fields)

def build(recipe, folder):
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT/'apps/desktop/src-tauri/scripts/blender/blender_build.py', folder/'build.py')
    shutil.copyfile(ROOT/'apps/desktop/src-tauri/scripts/blender/blender_reference.py', folder/'blender_reference.py')
    shutil.copyfile(ROOT/'apps/desktop/src-tauri/scripts/blender/blender_reconstruction.py', folder/'blender_reconstruction.py')
    (folder/'references.json').write_text('[]')
    shutil.copyfile(ROOT/'packages/contracts/src/model3d-materials.json', folder/'model3d-materials.json')
    (folder/'recipe.json').write_text(json.dumps(recipe))
    run = subprocess.run([BLENDER,'--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',str(folder/'build.py'),'--',str(folder/'recipe.json'),str(folder)], capture_output=True, text=True, timeout=150)
    (folder/'build.log').write_text(run.stdout+run.stderr)
    return run

def main(destination):
    destination.mkdir(parents=True,exist_ok=True)
    recipe=dict(name='Workshop display',category='prop',seed=19,exportFormat='glb',parts=[])
    p=recipe['parts']
    p.append(part('wood-top',position=(0,3.1,0),size=(6,.3,3),color='#93633c',material='Wood',bevel=.05))
    for i,x in enumerate([-2.6,2.6]):
        for j,z in enumerate([-1.1,1.1]):
            p.append(part(f'leg-{i}-{j}',position=(x,1.5,z),size=(.28,3,.28),roughness=.66,metalness=0,bevel=.025))
    p.append(part('crossbar',position=(0,.7,1.1),size=(5.4,.2,.18),roughness=.66,metalness=0,bevel=.02))
    p.append(part('toolbox',position=(1.2,3.75,-.25),size=(2.0,1.0,1.2),color='#ce6a31',material='Plastic',bevel=.09,roughness=.42))
    p.append(part('toolbox-handle',primitive='torus',position=(1.2,4.35,-.25),size=(.65,.42,.12),color='#30343b',segments=32,roughness=.7,metalness=0))
    p.append(part('glass-canister',primitive='cylinder',position=(-1.3,3.85,0),size=(.8,1.2,.8),color='#7dc6cd',material='Glass',segments=48,opacity=.4,roughness=.1))
    p.append(part('canister-base',primitive='cylinder',position=(-1.3,3.3,0),size=(.82,.12,.82),color='#c2ccd4',segments=32,roughness=.22,metalness=.95))
    p.append(part('indicator',position=(2.05,3.85,.37),size=(.06,.14,.03),color='#50d8af',material='Neon',emissiveIntensity=1.7))
    for i,x in enumerate([-2.6,2.6]):
        for j,z in enumerate([-1.1,1.1]):
            p.append(part(f'bolt-{i}-{j}',primitive='cylinder',position=(x,3.27,z),size=(.09,.04,.09),color='#c2ccd4',segments=12,roughness=.22,metalness=.95))
    p.append(part('tiny-detail',position=(0,3.2505,1.4),size=(.002,.001,.003),color='#c2ccd4',roughness=.22,metalness=.95))
    p.append(part('profile-hook',primitive='profile',position=(-2,3.60,.7),size=(.5,.7,.08),color='#c2ccd4',profile={'outline':[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],'holes':[[[-.2,-.2],[-.2,.2],[.2,.2],[.2,-.2]]],'bevel':.005}))
    folder=destination/'workshop';run=build(recipe,folder);assert run.returncode==0,run.stdout+run.stderr
    metrics=json.loads((folder/'metrics.json').read_text());preview=json.loads((folder/'preview.json').read_text())
    assert metrics['parts']==len(p) and metrics['blendReopened'] and metrics['triangles']<=200000
    assert len(preview['meshes'])==len(p)
    for item in p:
        actual=next(m for m in preview['meshes'] if m['id']==item['id'])
        assert actual['color']==item['color'] and actual['material']==item['material']
        assert len(actual['positions'])==len(actual['normals']) and len(actual['positions'])%9==0
        assert all(math.isfinite(n) for n in actual['positions']+actual['normals'])
    assert not (folder/'model.glb').exists() and not (folder/'model.fbx').exists()
    verify=folder/'reopen.py'
    verify.write_text("""import bpy,json,math,sys
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
""")
    check=subprocess.run([BLENDER,'--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',str(verify),'--',str(folder)],capture_output=True,text=True,timeout=120)
    (folder/'reopen.log').write_text(check.stdout+check.stderr);assert check.returncode==0,check.stdout+check.stderr
    # Full part budget, with all identical surfaces sharing one material.
    many=dict(name='128 part fixture',category='prop',seed=0,exportFormat='glb',parts=[part(f'p{i}',position=(i%16,i//16,0),size=(.5,.5,.1),bevel=.01) for i in range(128)])
    run=build(many,destination/'part-budget');assert run.returncode==0,run.stdout+run.stderr
    large=json.loads((destination/'part-budget/metrics.json').read_text());assert large['parts']==128 and large['materials']==1
    excessive=dict(name='Over tessellated fixture',category='prop',seed=0,exportFormat='glb',parts=[part(f's{i}',primitive='sphere',segments=64) for i in range(64)])
    run=build(excessive,destination/'triangle-budget');assert run.returncode!=0 and '200000 triangles' in run.stdout+run.stderr
    assert not (destination/'triangle-budget/model.blend').exists(), 'Excessive model must not produce a final export'
    report={'ok':True,'providerTested':False,'studioTested':False,'workshop':metrics,'reopened':json.loads((folder/'reopened.json').read_text()),'partBudget':large,'triangleLimitEnforced':True,'blendAlbedoAndPbrMatched':True,'noModelExports':True}
    (destination/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args();main(args.output.resolve())
