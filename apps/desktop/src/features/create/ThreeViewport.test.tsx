import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { ThreeViewport } from './ThreeViewport';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps every imported object reachable beyond the old 512-node limit', () => {
  vi.stubGlobal('WebGLRenderingContext', undefined);
  const scene = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  for (let i = 0; i < 513; i++) {
    const mesh = new Mesh(geometry, material); mesh.name = `Imported part ${i}`; scene.add(mesh);
  }
  render(<ThreeViewport object={scene} label="Imported model" />);
  fireEvent.click(screen.getByRole('button', { name: 'Struktur objek' }));
  const structure = within(screen.getByRole('complementary', { name: 'Struktur objek 3D' }));
  expect(structure.queryByRole('button', { name: 'Imported part 512' })).toBeNull();
  while (structure.queryByRole('button', { name: /Tampilkan berikutnya/ })) {
    fireEvent.click(structure.getByRole('button', { name: /Tampilkan berikutnya/ }));
  }
  expect(structure.getByRole('button', { name: 'Imported part 512' })).toBeTruthy();
  expect(structure.getAllByRole('button')).toHaveLength(513);
  geometry.dispose(); material.dispose();
});
