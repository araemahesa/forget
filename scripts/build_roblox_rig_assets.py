"""Decode the standard Roblox rig meshes used by the viewport (build time only).

Rig transforms were read from Studio's bundled avatar models without parenting them
into the map. Mesh v2 layout: https://devforum.roblox.com/t/326114
"""
import concurrent.futures
import gzip
import hashlib
import json
import math
import re
import struct
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'apps/desktop/src/features/create'
rigs = json.loads((DEST / 'roblox-rigs.json').read_text())
ids = sorted({re.search(r'id=(\d+)', part['mesh']).group(1)
              for rig in rigs['rigs'].values() for part in rig['parts'] if part['mesh']})

def decode(data, source):
    if data.startswith(b'\x1f\x8b'):
        data = gzip.decompress(data)
    prefix = b'version 2.00\n'
    assert data.startswith(prefix), f'Unsupported mesh format from {source}'
    header, stride, face_stride, vertices, faces = struct.unpack_from('<HBBII', data, len(prefix))
    assert header == 12 and stride in (36, 40) and face_stride == 12
    assert 0 < vertices < 20000 and 0 < faces < 40000
    offset = len(prefix) + header
    assert offset + vertices * stride + faces * face_stride <= len(data)
    values = [struct.unpack_from('<8f', data, offset + index * stride) for index in range(vertices)]
    indices = list(struct.unpack_from(f'<{faces * 3}I', data, offset + vertices * stride))
    assert max(indices) < vertices and all(math.isfinite(n) for row in values for n in row)
    return {'source': source, 'sha256': hashlib.sha256(data).hexdigest(),
            'positions': [round(n, 6) for row in values for n in row[:3]],
            'normals': [round(n, 6) for row in values for n in row[3:6]],
            'uv': [round(n, 6) for row in values for n in row[6:8]], 'indices': indices}

def fetch(asset_id):
    url = f'https://assetdelivery.roblox.com/v1/asset/?id={asset_id}'
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(4 * 1024 * 1024)
    return asset_id, decode(data, url)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    meshes = dict(pool.map(fetch, ids))
head = Path('/Applications/RobloxStudio.app/Contents/Resources/content/avatar/heads/head.mesh')
meshes['head'] = decode(head.read_bytes(), 'rbxasset://avatar/heads/head.mesh')
(DEST / 'roblox-rig-meshes.json').write_text(json.dumps(meshes, separators=(',', ':')) + '\n')
print(f'Validated {len(meshes)} Roblox meshes; {sum(len(m["indices"]) // 3 for m in meshes.values())} triangles')
