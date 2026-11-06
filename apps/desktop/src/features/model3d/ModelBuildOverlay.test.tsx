import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ModelBuildOverlay } from './ModelBuildOverlay';
afterEach(cleanup);
it('labels unfinished candidates and reports only real part counts, without invented percentages', () => {
  const { rerender } = render(<ModelBuildOverlay phase="building" hasModel={false} builtParts={2} totalParts={5} />);
  expect(screen.getByRole('status')).toHaveTextContent('2/5 komponen');
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<ModelBuildOverlay phase="comparing_reference" hasModel stopping />);
  expect(screen.getByRole('status')).toHaveTextContent('Menghentikan proses');
  expect(screen.getByRole('status')).toHaveTextContent('Kandidat Blender · pemeriksaan belum selesai');
});
