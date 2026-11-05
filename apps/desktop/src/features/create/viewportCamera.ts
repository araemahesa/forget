import { MathUtils } from 'three';

/** Fit the bounding sphere through both axes, including narrow editor panels. */
export function frameDistance(radius: number, verticalFov: number, aspect: number) {
  const vertical = MathUtils.degToRad(verticalFov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
}

export function frameClipping(radius: number, distance: number) {
  return { near: Math.max(radius / 10000, .00001), far: Math.max(distance * 30, 1), minDistance: Math.max(radius * .05, .00001) };
}
