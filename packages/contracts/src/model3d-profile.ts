type Point = [number, number];
const epsilon = 1e-9;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersects(a: Point, b: Point, c: Point, d: Point) {
  const on = (p: Point, q: Point, r: Point) => Math.abs(cross(p, q, r)) <= epsilon &&
    r.every((n, axis) => n >= Math.min(p[axis], q[axis]) - epsilon && n <= Math.max(p[axis], q[axis]) + epsilon);
  const side = (value: number) => value > epsilon ? 1 : value < -epsilon ? -1 : 0;
  return (side(cross(a, b, c)) * side(cross(a, b, d)) < 0 && side(cross(c, d, a)) * side(cross(c, d, b)) < 0) ||
    on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
function inside(point: Point, ring: Point[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** Rings have already passed numeric and length validation. Touching boundaries are invalid holes. */
export function validModel3dProfileRings(rings: Point[][]) {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const next = (i + 1) % ring.length;
      if (Math.hypot(ring[i][0] - ring[next][0], ring[i][1] - ring[next][1]) <= epsilon) return false;
      for (let j = i + 1; j < ring.length; j++) {
        if (j !== next && (j + 1) % ring.length !== i && intersects(ring[i], ring[next], ring[j], ring[(j + 1) % ring.length])) return false;
      }
    }
  }
  for (let i = 1; i < rings.length; i++) {
    if (!inside(rings[i][0], rings[0])) return false;
    for (let j = 0; j < i; j++) {
      if (j > 0 && (inside(rings[i][0], rings[j]) || inside(rings[j][0], rings[i]))) return false;
      for (let a = 0; a < rings[i].length; a++) for (let b = 0; b < rings[j].length; b++) {
        if (intersects(rings[i][a], rings[i][(a + 1) % rings[i].length], rings[j][b], rings[j][(b + 1) % rings[j].length])) return false;
      }
    }
  }
  return true;
}
