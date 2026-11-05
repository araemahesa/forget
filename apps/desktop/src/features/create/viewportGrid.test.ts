import { Box3, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { viewportGrid } from './viewportGrid';
it('keeps a broad, coarse floor under off-origin models at small and large scales', () => {
  for (const scale of [.01, 1, 1000]) {
    const bounds = new Box3(new Vector3(400, 20, -100), new Vector3(400 + scale * 6, 20 + scale * 4, -100 + scale * 2));
    const grid = viewportGrid(bounds), extent = bounds.getSize(new Vector3()).length();
    expect(grid.size).toBeGreaterThanOrEqual(extent * 20);
    expect(grid.size / grid.divisions).toBeGreaterThan(extent * 2 / 40);
    expect(grid.x).toBeCloseTo(400 + scale * 3);
    expect(grid.y).toBeLessThan(bounds.min.y);
    expect(Number.isFinite(grid.size)).toBe(true);
  }
  expect(viewportGrid(new Box3()).size).toBeGreaterThan(20);
});
