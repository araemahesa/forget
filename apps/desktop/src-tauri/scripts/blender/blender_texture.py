"""Bounded UV projection of observed color. No inferred albedo or unseen detail."""
import base64
import struct
import zlib

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from blender_reconstruction import PROJECTIONS, sample


def png_bytes(pixels):
    height, width = pixels.shape[:2]
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(b''.join(b'\0' + row.tobytes() for row in pixels))) + chunk(b'IEND', b''))


def atlas_layout(view_count, pixel_budget):
    count = view_count + 1
    side = 1024 if count <= 4 else 512
    columns = 2 if count <= 4 else 3
    rows = (count + columns - 1) // columns
    while columns * rows * side * side > pixel_budget:
        side //= 2
    return columns, rows, side


def project_texture(obj, views, base_color, output, pixel_budget):
    """One source view per face avoids color blending across markings and occlusion."""
    columns, rows, side = atlas_layout(len(views), pixel_budget)
    width, height = columns * side, rows * side
    atlas = np.empty((height, width, 4), dtype=np.uint8)
    atlas[:] = [*np.rint(base_color * 255).astype(np.uint8), 255]
    border = 4
    for index, view in enumerate(views):
        pixels = view.get('colorPixels', view['pixels'])
        yy = np.clip(((np.arange(side - border*2) + .5) * pixels.shape[0] / (side - border*2)).astype(int), 0, pixels.shape[0]-1)
        xx = np.clip(((np.arange(side - border*2) + .5) * pixels.shape[1] / (side - border*2)).astype(int), 0, pixels.shape[1]-1)
        color = pixels[yy[:, None], xx[None, :], :3].copy()
        my = np.minimum((np.arange(len(yy)) * view['mask'].shape[0] / len(yy)).astype(int), view['mask'].shape[0]-1)
        mx = np.minimum((np.arange(len(xx)) * view['mask'].shape[1] / len(xx)).astype(int), view['mask'].shape[1]-1)
        known = view['mask'][my[:, None], mx[None, :]].copy()
        # Dilate observed edge colors into padding; do not sample the background at silhouettes.
        for _ in range(8):
            previous = known.copy()
            for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
                neighbor = np.roll(previous, (dy,dx), (0,1))
                if dy: neighbor[0 if dy > 0 else -1, :] = False
                if dx: neighbor[:, 0 if dx > 0 else -1] = False
                fill = ~known & neighbor
                color[fill] = np.roll(color, (dy,dx), (0,1))[fill]
                known |= fill
        color[~known] = base_color
        tile = np.empty((side,side,4), dtype=np.uint8)
        tile[..., :3] = np.rint(np.pad(np.clip(color,0,1), ((border,border),(border,border),(0,0)), mode='edge') * 255).astype(np.uint8)
        tile[..., 3] = 255
        row, column = divmod(index, columns)
        atlas[row*side:(row+1)*side, column*side:(column+1)*side] = tile
    points = np.array([v.co[:] for v in obj.data.vertices])
    polygons = [list(p.vertices) for p in obj.data.polygons]
    tree = BVHTree.FromPolygons([Vector(p) for p in points], polygons)
    uv = obj.data.uv_layers.new(name='ForgeKitReferenceUV')
    observed = rejected = 0
    for polygon in obj.data.polygons:
        indices = list(polygon.vertices)
        center = points[indices].mean(axis=0)
        normal = np.array(polygon.normal[:])
        choices = []
        for index, view in enumerate(views):
            direction = np.array(PROJECTIONS[view['view']][4], dtype=float)
            weight = float(normal @ direction)
            if weight <= .05:
                continue
            v, u = sample(view, center)
            if not view['mask'][v,u]:
                continue
            hit, _, _, _ = tree.ray_cast(Vector(center + direction*3), Vector(-direction), 4)
            if hit is None or np.linalg.norm(np.array(hit)-center) > .004:
                rejected += 1
                continue
            choices.append((weight,index))
        index = max(choices)[1] if choices else len(views)
        observed += bool(choices)
        row, column = divmod(index, columns)
        if choices:
            horizontal, vertical, sign_u, sign_v, _ = PROJECTIONS[views[index]['view']]
        for loop in polygon.loop_indices:
            point = points[obj.data.loops[loop].vertex_index]
            u, v = ((np.clip(point[horizontal]*sign_u+.5,0,1), np.clip(point[vertical]*sign_v+.5,0,1)) if choices else (.5,.5))
            uv.data[loop].uv = ((column*side + border + u*(side-2*border))/width,
                                1-(row*side + border + v*(side-2*border))/height)
    # Object names come from validated identifiers; keep filesystem names independent of display names.
    path = output / f"texture-{len(bpy.data.images)}.png"
    data = png_bytes(atlas)
    path.write_bytes(data)
    image = bpy.data.images.load(str(path), check_existing=False)
    image.name = 'ForgeKitReferenceTexture ' + obj.name
    image.colorspace_settings.name = 'sRGB'
    image.pack()
    image.filepath = '//ForgeKitTextures/' + path.name
    obj['ForgeKitTextureImage'] = image.name
    return dict(method='visible-face-reference-projection', width=width, height=height,
                observedFaceFraction=round(observed/max(1,len(polygons)),4), occludedCandidatesRejected=rejected,
                unobservedColor='recipe-base-color', colorSpace='sRGB', packed=True)


def preview_texture(obj):
    image = bpy.data.images.get(obj.get('ForgeKitTextureImage',''))
    if not image:
        return {}
    return {'uvs': [round(float(c),7) for tri in obj.data.loop_triangles for loop in tri.loops
                    for c in obj.data.uv_layers['ForgeKitReferenceUV'].data[loop].uv],
            'texture': {'width': image.size[0], 'height': image.size[1],
                        'dataUrl': 'data:image/png;base64,' + base64.b64encode(image.packed_file.data).decode()}}
