import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Broken(): never { throw new Error('Kuota penyimpanan penuh'); }

it('shows an Indonesian fallback with a reload action instead of a blank window', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  render(<ErrorBoundary><Broken /></ErrorBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('Terjadi kesalahan pada tampilan');
  expect(screen.getByText('Kuota penyimpanan penuh')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('renders children when nothing fails', () => {
  render(<ErrorBoundary><p>Siap</p></ErrorBoundary>);
  expect(screen.getByText('Siap')).toBeInTheDocument();
});
