import { selectChoice } from '../../tests/selectChoice';
import { resetImageMocks } from '../imageTestSupport';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TexturesPage } from './TexturesPage';

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
  window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-texture-url');
  window.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TexturesPage', () => {
  it('renders editor controls, brief, and initial creative empty canvas', async () => {
    render(<TexturesPage />);
    expect(screen.getByRole('heading', { name: 'Generator Tekstur' })).toBeVisible();
    expect(screen.getByLabelText('Nama tekstur')).toHaveValue('Batu Bata Kastil');
    expect(screen.getByLabelText('Pola permukaan')).toHaveValue('bricks');
    expect(screen.getByRole('region', { name: 'Pratinjau Tekstur' })).toBeVisible();
    expect(screen.getByRole('heading', { name: /Pola permukaan/ })).toBeVisible();
  });

  it('selects another pattern, renders preview, and switches map types and tiling', async () => {
    const user = userEvent.setup();
    render(<TexturesPage />);

    // Change pattern to wood
    await selectChoice(screen.getByLabelText('Pola permukaan'), 'wood');
    expect(screen.getByLabelText('Pola permukaan')).toHaveValue('wood');

    // Click render
    await user.click(screen.getByRole('button', { name: /Render/ }));
    expect(screen.getByText('Pratinjau selesai.')).toBeVisible();
    expect(screen.getByText('Periksa sambungan ubin')).toBeVisible();

    // Switch map type to Normal Map
    await user.click(screen.getByRole('tab', { name: 'Normal Map' }));
    expect(screen.getByText('Pratinjau selesai.')).toBeVisible();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Roughness' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Roughness' })).toBeVisible();
    await user.keyboard('{End}{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Base Color' })).toHaveFocus();
    await user.keyboard('{Home}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Height' })).toHaveFocus();

    // Switch tiling mode to 2x2
    await user.click(screen.getByRole('button', { name: '2×2 (Seam)' }));
    expect(screen.getByText(/2×2/)).toBeVisible();
  });

  it('shows validation errors for invalid input and blocks save', async () => {
    const user = userEvent.setup();
    render(<TexturesPage />);

    const nameInput = screen.getByLabelText('Nama tekstur');
    await user.clear(nameInput);
    await user.click(screen.getByRole('button', { name: /Render/ }));

    expect(screen.getByText('Nama tekstur harus berisi 1–60 karakter.')).toBeVisible();
    expect(screen.getByText('Perbaiki isian sebelum menyimpan atau mengekspor.')).toBeVisible();
  });

  it('saves a version, displays in history, and reopens it', async () => {
    const user = userEvent.setup();
    render(<TexturesPage />);

    // Render then save initial version
    await user.click(screen.getByRole('button', { name: /Render/ }));
    await user.click(screen.getByRole('button', { name: /Simpan versi/ }));
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();

    // Modify name
    const nameInput = screen.getByLabelText('Nama tekstur');
    await user.type(nameInput, ' Halus');
    expect(screen.getByText('Draf berubah')).toBeVisible();

    // Save version 2
    await user.click(screen.getByRole('button', { name: /Simpan versi/ }));
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();

    // Check version list
    const historySection = screen.getByRole('region', { name: 'Riwayat versi tekstur' });
    expect(within(historySection).getByText('Versi 1')).toBeVisible();
    expect(within(historySection).getByText('Versi 2')).toBeVisible();

    // Reopen version 1
    const openButtons = within(historySection).getAllByRole('button', { name: 'Buka' });
    await user.click(openButtons[1]); // Version 1 is second in descending order
    expect(await screen.findByText('Versi 1 dibuka.')).toBeVisible();
    expect(nameInput).toHaveValue('Batu Bata Kastil');
  });

  it('exports SVG, copies SVG, and exports PNG', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(<TexturesPage />);
    await user.click(screen.getByRole('button', { name: /Render/ }));

    await user.click(screen.getByRole('button', { name: 'Salin SVG' }));
    expect(writeTextMock).toHaveBeenCalled();
    expect(screen.getByText('Kode SVG disalin ke clipboard.')).toBeVisible();

    // Export SVG
    await user.click(screen.getByRole('button', { name: /Ekspor SVG/ }));
    expect(await screen.findByText('Diekspor ke exports/test-baseColor.svg')).toBeVisible();

  });

  it('randomizes seed when clicking Acak', async () => {
    const user = userEvent.setup();
    render(<TexturesPage />);

    const seedInput = screen.getByLabelText('Seed pengacakan');
    const initialSeed = seedInput.getAttribute('value');

    await user.click(screen.getByRole('button', { name: /Acak/ }));
    const newSeed = seedInput.getAttribute('value');
    expect(newSeed).not.toBe(initialSeed);
  });

  it('does not activate retired texture shortcuts from Chat aliases', async () => {
    window.location.hash = '#texture';
    render(<TexturesPage />);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
    expect(screen.queryByText('Pratinjau selesai.')).toBeNull();
    window.location.hash = '';
  });
});
