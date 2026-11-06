import { resetImageMocks } from '../shared/imageTestSupport';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconsPage } from './IconsPage';

vi.mock('../../engines/gfx/png', () => ({
  svgToPng: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
}));

beforeEach(() => {
  resetImageMocks();
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IconsPage', () => {
  it('renders editor controls, glyph picker, and default icon preview', async () => {
    render(<IconsPage />);
    expect(screen.getByRole('heading', { name: 'Generator Ikon' })).toBeVisible();
    expect(screen.getByLabelText('Nama ikon')).toHaveValue('Pedang Legendaris');
    expect(screen.getByRole('radio', { name: 'Pedang' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('region', { name: 'Pratinjau Ikon' })).toBeVisible();
    expect(screen.getByText(/Ikon tajam, seragam/)).toBeVisible();
  });

  it('selects another glyph from the picker and updates preview', async () => {
    const user = userEvent.setup();
    render(<IconsPage />);

    const shieldRadio = screen.getByRole('radio', { name: 'Perisai' });
    await user.click(shieldRadio);
    expect(shieldRadio).toHaveAttribute('aria-checked', 'true');

    // Click render
    await user.click(screen.getByRole('button', { name: /Render/ }));
    expect(screen.getByText('Pratinjau selesai.')).toBeVisible();
  });

  it('shows validation errors for invalid icon name and blocks save', async () => {
    const user = userEvent.setup();
    render(<IconsPage />);

    const nameInput = screen.getByLabelText('Nama ikon');
    await user.clear(nameInput);
    await user.click(screen.getByRole('button', { name: /Render/ }));

    expect(screen.getByText('Nama ikon harus berisi 1–60 karakter.')).toBeVisible();
    expect(screen.getByText('Perbaiki isian sebelum menyimpan atau mengekspor.')).toBeVisible();
  });

  it('saves a version, displays in history, and reopens it', async () => {
    const user = userEvent.setup();
    render(<IconsPage />);

    // Render then save initial version
    await user.click(screen.getByRole('button', { name: /Render/ }));
    await user.click(screen.getByRole('button', { name: /Simpan versi/ }));
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();
    expect(screen.getByText('Versi 1 tersimpan')).toBeVisible();

    // Modify name
    const nameInput = screen.getByLabelText('Nama ikon');
    await user.type(nameInput, ' Baru');
    expect(screen.getByText('Draf berubah')).toBeVisible();

    // Save version 2
    await user.click(screen.getByRole('button', { name: /Simpan versi/ }));
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();

    // Check version list
    const historySection = screen.getByRole('region', { name: 'Riwayat versi ikon' });
    expect(within(historySection).getByText('Versi 1')).toBeVisible();
    expect(within(historySection).getByText('Versi 2')).toBeVisible();

    // Reopen version 1
    const openButtons = within(historySection).getAllByRole('button', { name: 'Buka' });
    await user.click(openButtons[1]); // Version 1 is second in descending order
    expect(await screen.findByText('Versi 1 dibuka.')).toBeVisible();
    expect(nameInput).toHaveValue('Pedang Legendaris');
  });

  it('exports SVG and copies SVG to clipboard', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(<IconsPage />);
    await user.click(screen.getByRole('button', { name: /Render/ }));
    await user.click(screen.getByRole('button', { name: 'Salin SVG' }));
    expect(writeTextMock).toHaveBeenCalled();
    expect(screen.getByText('Kode SVG disalin ke clipboard.')).toBeVisible();

    // Export SVG
    await user.click(screen.getByRole('button', { name: /Ekspor SVG/ }));
    expect(await screen.findByText('Diekspor ke exports/test-icon.svg')).toBeVisible();

  });

  it('handles keyboard shortcuts for render and save', async () => {
    window.location.hash = '#icons';
    render(<IconsPage />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
    });
    expect(screen.getByText('Pratinjau selesai.')).toBeVisible();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
      );
    });
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();
    window.location.hash = '';
  });
});
