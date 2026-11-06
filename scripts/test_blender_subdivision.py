"""Exercise the trusted builder with real Blender; no provider or user database."""
import json, pathlib, shutil, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='forgekit-subdivision-') as work:
    work = pathlib.Path(work)
    for level in (0, 2):
        dest = work / str(level)
        dest.mkdir()
        for name in ('blender_build.py', 'blender_reference.py', 'blender_reconstruction.py', 'blender_texture.py'):
            shutil.copy2(root / 'apps/desktop/src-tauri/scripts/blender' / name, dest / name)
        shutil.copy2(root / 'packages/contracts/src/model3d-materials.json', dest)
        part = dict(id='body', name='Organic cage', primitive='mesh', position=[0,0,0], size=[4,2,2], rotation=[0,0,0], color='#404550', material='Plastic', subdivision=level, mesh=dict(vertices=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]))
        (dest/'recipe.json').write_text(json.dumps(dict(name='Subdivision fixture', category='creature', seed=0, exportFormat='blend', parts=[part])))
        (dest/'references.json').write_text('[]')
        result = subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender','--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',str(dest/'blender_build.py'),'--',str(dest/'recipe.json'),str(dest)],capture_output=True,text=True,timeout=120)
        assert result.returncode == 0, result.stdout + result.stderr
        metrics = json.loads((dest/'metrics.json').read_text())
        assert metrics['blendReopened'] is True
        assert metrics['triangles'] == (12 if level == 0 else 192), metrics
        preview = json.loads((dest/'preview.json').read_text())
        assert len(preview['meshes'][0]['positions']) == metrics['triangles'] * 9
        print(f"Subdivision {level}: {metrics['triangles']} triangles, reopened blend and matching preview")
