import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { modelReveal } from './modelReveal';

it('reveals actual triangles monotonically and restores original draw range and translucent materials', () => {
  const group = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ opacity: .6, transparent: true }));
  group.add(mesh); mesh.geometry.setDrawRange(3, 30);
  const animation = modelReveal(group, false);
  expect(mesh.geometry.drawRange).toEqual({ start: 3, count: 0 });
  animation.update(.4); const count = mesh.geometry.drawRange.count;
  expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(30);
  expect(mesh.material.opacity).toBeLessThan(.6);
  animation.update(.4); expect(mesh.geometry.drawRange.count).toBeGreaterThanOrEqual(count);
  animation.update(1);
  expect(mesh.geometry.drawRange).toEqual({ start: 3, count: 30 });
  expect(mesh.material.opacity).toBe(.6); expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(true);
  mesh.geometry.dispose(); mesh.material.dispose();
});

it('supports reduced motion and restores the original object when an animation is interrupted', () => {
  const group = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); group.add(mesh);
  const still = modelReveal(group, true); still.update(.2);
  expect(mesh.geometry.drawRange.count).toBe(Infinity); expect(mesh.material.transparent).toBe(false);
  const running = modelReveal(group, false); running.update(.2); running.restore(); running.update(.2);
  expect(mesh.geometry.drawRange.count).toBe(Infinity); expect(mesh.material.opacity).toBe(1); expect(mesh.material.transparent).toBe(false);
  mesh.geometry.dispose(); mesh.material.dispose();
});
