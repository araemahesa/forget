"""Local visual hull from selected orthographic reference crops, not generated code.

Only silhouettes constrain volume. Concavities and unseen appearance remain unknown.
"""
import base64
import json
import time
from collections import deque

import numpy as np


# Recipe coordinates: Y up, front +Z. Image coordinates: origin at top left.
PROJECTIONS = {
    'front': (0, 1, 1, -1, (0, 0, 1)),
    'back': (0, 1, -1, -1, (0, 0, -1)),
    'right': (2, 1, -1, -1, (1, 0, 0)),
    'left': (2, 1, 1, -1, (-1, 0, 0)),
    'top': (0, 2, 1, 1, (0, 1, 0)),
    'bottom': (0, 2, 1, -1, (0, -1, 0)),
}


def largest_component(mask):
    """Drop labels and detached background noise; one crop represents one object."""
    visited = np.zeros_like(mask)
    best = []
    height, width = mask.shape
    for y, x in zip(*np.nonzero(mask)):
        if visited[y, x]:
            continue
        queue = deque([(int(y), int(x))])
        visited[y, x] = True
        component = []
        while queue:
            row, column = queue.popleft()
            component.append((row, column))
            for r, c in ((row-1, column), (row+1, column), (row, column-1), (row, column+1)):
                if 0 <= r < height and 0 <= c < width and mask[r, c] and not visited[r, c]:
                    visited[r, c] = True
                    queue.append((r, c))
        if len(component) > len(best):
            best = component
    result = np.zeros_like(mask)
    if best:
        rows, columns = zip(*best)
        result[rows, columns] = True
    return result


def prepare_view(pixels, view, size):
    height, width = pixels.shape[:2]
    x, y, w, h = view['crop']
    pixels = pixels[round(y*height):round((y+h)*height), round(x*width):round((x+w)*width)]
    if min(pixels.shape[:2]) < 8:
        raise ValueError('Rekonstruksi: crop referensi terlalu kecil (minimum 8 piksel).')
    original = pixels
    # Bound segmentation cost independently of the original attachment resolution.
    stride = max(1, int(np.ceil(max(pixels.shape[:2]) / 512)))
    pixels = pixels[::stride, ::stride]
    if view['background'] == 'alpha':
        if pixels[..., 3].min() >= .99:
            raise ValueError('Rekonstruksi: background alpha memerlukan gambar transparan, bukan PNG opaque.')
        mask = pixels[..., 3] > .5
    else:
        background = np.array([int(view['background'][i:i+2], 16)/255 for i in (1, 3, 5)])
        mask = (np.linalg.norm(pixels[..., :3] - background, axis=2) > view['tolerance'] * np.sqrt(3)) & (pixels[..., 3] > .5)
    mask = largest_component(mask)
    area = int(mask.sum())
    if area < 32 or area / mask.size > .96 or area / mask.size < .005:
        raise ValueError('Rekonstruksi: siluet tidak terbaca. Pilih crop satu objek dan background polos/alpha yang benar.')
    rows, columns = np.nonzero(mask)
    low_y, high_y, low_x, high_x = rows.min(), rows.max()+1, columns.min(), columns.max()+1
    horizontal, vertical, _, _, _ = PROJECTIONS[view['view']]
    aspect = (high_x-low_x)/(high_y-low_y)
    expected = size[horizontal]/size[vertical]
    if max(aspect/expected, expected/aspect) > 1.35:
        raise ValueError('Rekonstruksi: rasio size berbeda dari siluet lebih dari 35%. Perbaiki ukuran atau arah/crop ortografis.')
    return dict(view=view['view'], image=view['image'],
                mask=mask[low_y:high_y, low_x:high_x],
                pixels=pixels[low_y:high_y, low_x:high_x],
                colorPixels=original[low_y*stride:min(high_y*stride, original.shape[0]),
                                     low_x*stride:min(high_x*stride, original.shape[1])],
                foregroundPixels=area)


def sample(view, coordinates):
    horizontal, vertical, sign_u, sign_v, _ = PROJECTIONS[view['view']]
    height, width = view['mask'].shape
    u = np.clip(((coordinates[..., horizontal] * sign_u + .5) * width).astype(int), 0, width-1)
    v = np.clip(((coordinates[..., vertical] * sign_v + .5) * height).astype(int), 0, height-1)
    return v, u


def carve(views, resolution):
    axis = (np.arange(resolution, dtype=np.float32) + .5)/resolution - .5
    coordinates = np.stack(np.meshgrid(axis, axis, axis, indexing='ij'), axis=-1)
    volume = np.ones((resolution,)*3, dtype=bool)
    for view in views:
        v, u = sample(view, coordinates)
        volume &= view['mask'][v, u]
    if volume.sum() < 32:
        raise ValueError('Rekonstruksi: siluet antar-sudut tidak menghasilkan volume yang konsisten.')
    scores = []
    for view in views:
        # Compare at voxel resolution, avoiding false penalties from unsampled source pixels.
        horizontal, vertical, _, _, _ = PROJECTIONS[view['view']]
        others = ({0, 1, 2} - {horizontal, vertical}).pop()
        observed = volume.any(axis=others)
        grid = np.stack(np.meshgrid(axis, axis, indexing='ij'), axis=-1)
        coords = np.zeros((resolution, resolution, 3), dtype=np.float32)
        ordered = [i for i in range(3) if i != others]
        coords[..., ordered[0]], coords[..., ordered[1]] = grid[..., 0], grid[..., 1]
        vv, uu = sample(view, coords)
        target = view['mask'][vv, uu]
        score = float((observed & target).sum()/max(1, (observed | target).sum()))
        scores.append(dict(view=view['view'], image=view['image'], silhouetteIou=round(score, 4)))
    if min(item['silhouetteIou'] for item in scores) < .72:
        raise ValueError('Rekonstruksi: siluet antar-sudut tidak cocok (IoU di bawah 0,72). Jangan gabungkan pose/perspektif berbeda.')
    return volume, scores


def boundary_mesh(volume):
    faces = []
    # Consistent quad winding; shared integer lattice corners avoid mesh cracks.
    corners = [
        [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],
        [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
        [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
        [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
        [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
        [[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
    ]
    padded = np.pad(volume, 1)
    for axis in range(3):
        for side in range(2):
            slices = [slice(1, -1)]*3
            slices[axis] = slice(2, None) if side else slice(None, -2)
            cells = np.argwhere(volume & ~padded[tuple(slices)])
            if len(cells):
                faces.append(cells[:, None, :] + np.array(corners[axis*2+side])[None, :, :])
    corners = np.concatenate(faces).reshape(-1, 3)
    vertices, indices = np.unique(corners, axis=0, return_inverse=True)
    return vertices.astype(np.float32)/volume.shape[0]-.5, indices.reshape(-1, 4)


def linear_rgb(rgb):
    return np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)


def reconstruct(part, output, remaining_triangles):
    import bpy
    import bmesh
    started = time.monotonic()
    print('FORGEKIT_STAGE reconstruction: membaca siluet', flush=True)
    if remaining_triangles < 32:
        raise ValueError('Budget triangle tidak cukup untuk rekonstruksi referensi.')
    spec = part['reconstruction']
    references = json.loads((output/'references.json').read_text())
    images, views = {}, []
    for view in spec['views']:
        index = view['image']
        if index >= len(references):
            raise ValueError('Rekonstruksi: indeks gambar tidak ada pada referensi tugas saat ini.')
        if index not in images:
            path = output/f'reconstruction-input-{index}.png'
            path.write_bytes(base64.b64decode(references[index]['dataUrl'].removeprefix('data:image/png;base64,'), validate=True))
            image = bpy.data.images.load(str(path), check_existing=False)
            image.colorspace_settings.name = 'Non-Color'
            pixels = np.empty(image.size[0]*image.size[1]*4, dtype=np.float32)
            image.pixels.foreach_get(pixels)
            images[index] = pixels.reshape(image.size[1], image.size[0], 4)[::-1].copy()
            bpy.data.images.remove(image)
        views.append(prepare_view(images[index], view, part['size']))
    volume, scores = carve(views, spec['resolution'])
    print('FORGEKIT_STAGE reconstruction: membentuk volume', flush=True)
    points, faces = boundary_mesh(volume)
    if len(faces)*2 > max(remaining_triangles*3, 600000):
        raise ValueError('Rekonstruksi terlalu rumit. Kurangi resolution atau bersihkan background.')
    mesh = bpy.data.meshes.new(part['id'])
    mesh.from_pydata(points.tolist(), [], faces.tolist())
    mesh.update()
    obj = bpy.data.objects.new(part['id'], mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new('ForgeKit silhouette smoothing', 'SMOOTH')
    modifier.factor = .5
    modifier.iterations = 4
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Dense planar voxel faces waste preview memory without adding silhouette detail.
    target = min({64:12000,96:24000,128:48000}[spec['resolution']], remaining_triangles)
    if len(obj.data.polygons)*2 > target:
        modifier = obj.modifiers.new('ForgeKit reconstruction budget', 'DECIMATE')
        modifier.ratio = target/(len(obj.data.polygons)*2) * .98
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    topology = bmesh.new()
    topology.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    if any(not edge.is_manifold for edge in topology.edges):
        topology.free()
        raise ValueError('Rekonstruksi menghasilkan sambungan non-manifold; perbaiki crop/resolusi.')
    topology.to_mesh(obj.data)
    topology.free()
    obj.data.update()
    points = np.array([vertex.co[:] for vertex in obj.data.vertices])
    normals = np.array([vertex.normal[:] for vertex in obj.data.vertices])
    rgb = np.array([int(part['color'][i:i+2], 16)/255 for i in (1,3,5)])
    color_sum = np.zeros((len(points), 3))
    weights = np.zeros(len(points))
    for view in views:
        v, u = sample(view, points)
        direction = np.array(PROJECTIONS[view['view']][4])
        weight = np.maximum(0, normals @ direction)**4 * view['mask'][v, u]
        color_sum += linear_rgb(view['pixels'][v, u, :3]) * weight[:, None]
        weights += weight
    colors = np.tile(linear_rgb(rgb), (len(points), 1))
    visible = weights > .001
    colors[visible] = color_sum[visible]/weights[visible, None]
    attribute = obj.data.color_attributes.new(name='ForgeKitReferenceColor', type='FLOAT_COLOR', domain='POINT')
    attribute.data.foreach_set('color', np.column_stack((colors, np.ones(len(points)))).astype(np.float32).ravel())
    from blender_texture import project_texture
    texture_metrics = project_texture(obj, views, rgb, output)
    obj['ForgeKitReconstruction'] = json.dumps(dict(texture=texture_metrics, method='orthographic-visual-hull', resolution=spec['resolution'],
        views=scores, coloredVertexFraction=round(float(visible.mean()), 4), elapsedSeconds=round(time.monotonic()-started, 3),
        limitations=['Siluet membatasi volume; rongga tersembunyi tidak direkonstruksi.',
                     'Warna proyeksi masih memuat pencahayaan gambar; sisi tanpa referensi memakai warna dasar.']))
    print('FORGEKIT_STAGE reconstruction: geometri dan warna siap', flush=True)
    return obj
