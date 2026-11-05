import { expect, it } from 'vitest';
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { frameClipping, frameDistance } from './viewportCamera';

it.each([.2, .5, 1, 16 / 9, 4])('frames actual 3D bounds on both axes at aspect %s', aspect => {
  const bounds = new Box3(new Vector3(-8, -3, -2), new Vector3(8, 3, 2));
  const radius = bounds.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(40, aspect, .01, 10000);
  camera.position.set(1, .6, 1).normalize().multiplyScalar(frameDistance(radius, camera.fov, aspect));
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  for (const x of [-8, 8]) for (const y of [-3, 3]) for (const z of [-2, 2]) {
    const point = new Vector3(x, y, z).project(camera);
    expect(Math.abs(point.x)).toBeLessThan(1);
    expect(Math.abs(point.y)).toBeLessThan(1);
    expect(point.z).toBeGreaterThan(-1); expect(point.z).toBeLessThan(1);
  }
});

it('preserves sphere framing when resizing between wide and portrait panels', () => {
  const wide = frameDistance(5, 40, 2), narrow = frameDistance(5, 40, .4);
  expect(narrow).toBeGreaterThan(wide);
  expect(wide).toBeCloseTo(5 / Math.sin(MathUtils.degToRad(20)) * 1.15);
  expect(wide * (narrow / wide) * (wide / narrow)).toBeCloseTo(wide);
});

it.each([.001, .05, 1, 1000])('keeps small and large model bounds inside the camera at radius %s', radius => {
  const distance = frameDistance(radius, 40, 1);
  const limits = frameClipping(radius, distance);
  expect(limits.near).toBeLessThan(distance - radius);
  expect(limits.far).toBeGreaterThan(distance + radius);
  expect(limits.minDistance).toBeLessThan(radius);
  const camera = new PerspectiveCamera(40, 1, limits.near, limits.far);
  camera.position.z = distance; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  for (const z of [-radius, radius]) expect(Math.abs(new Vector3(0, 0, z).project(camera).z)).toBeLessThan(1);
});
