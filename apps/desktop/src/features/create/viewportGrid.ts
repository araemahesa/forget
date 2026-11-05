import { Box3, Vector3 } from 'three';

/** A broad floor with larger cells, shared by every 3D workspace. */
export function viewportGrid(bounds: Box3) {
  const empty = bounds.isEmpty();
  const extent = empty ? 8 : Math.max(bounds.getSize(new Vector3()).length(), .01);
  const step = 2 ** Math.ceil(Math.log2(Math.max(extent / 8, .25)));
  const center = empty ? new Vector3() : bounds.getCenter(new Vector3());
  return { size: step * 160, divisions: 160, x: center.x, y: empty ? 0 : bounds.min.y - extent * .0001, z: center.z };
}
