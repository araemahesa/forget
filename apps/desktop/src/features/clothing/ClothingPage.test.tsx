import { selectChoice } from '../../tests/selectChoice';
import { resetImageMocks } from '../shared/imageTestSupport';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClothingPage } from './ClothingPage';

vi.mock('../../engines/gfx/png', () => ({ svgToPng: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])) }));

beforeEach(() => {
  resetImageMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.location.hash = '#clothing';
});

describe('ClothingPage', () => {
  it('renders page header and initial controls', () => {
    render(<ClothingPage />);
    expect(screen.getByRole('heading', { name: 'Desainer Pakaian' })).toBeVisible();
    expect(screen.getByLabelText('Nama pakaian')).toHaveValue('Kemeja Petualang');
    expect(screen.getByRole('button', { name: /Render/ })).toBeVisible();
    expect(screen.getByText('Draf belum dirender.')).toBeVisible();
  });

  it('renders SVG template when clicking Render', async () => {
    const user = userEvent.setup();
    render(<ClothingPage />);

    await user.click(screen.getByRole('button', { name: /Render/ }));

    expect(await screen.findByText('Pratinjau selesai.')).toBeVisible();
    expect(document.querySelector('.clothing-hero-frame svg')).not.toBeNull();
  });

  it('switches between Template 2D and Manekin 2D/R6 modes', async () => {
    const user = userEvent.setup();
    render(<ClothingPage />);

    await user.click(screen.getByRole('button', { name: /Render/ }));
    expect(document.querySelector('.clothing-frame-template')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Manekin 2D/R6' }));
    expect(document.querySelector('.clothing-frame-avatar')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Template 2D' }));
    expect(document.querySelector('.clothing-frame-template')).not.toBeNull();
  });

  it('updates dimensions when switching to T-Shirt', async () => {
    const user = userEvent.setup();
    render(<ClothingPage />);

    const kindSelect = screen.getByLabelText('Jenis pakaian');
    await selectChoice(kindSelect, 'tshirt');

    expect(screen.getByText('512 × 512')).toBeVisible();
  });

  it('saves and opens versions', async () => {
    const user = userEvent.setup();
    render(<ClothingPage />);

    await user.click(screen.getByRole('button', { name: /Render/ }));
    const saveButton = screen.getByRole('button', { name: /Simpan versi/ });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();

    // Modify name
    const nameInput = screen.getByLabelText('Nama pakaian');
    await user.clear(nameInput);
    await user.type(nameInput, 'Kemeja Biru');
    expect(screen.getByText('Draf berubah')).toBeVisible();

    // Render & save version 2
    await user.click(screen.getByRole('button', { name: /Render/ }));
    await user.click(screen.getByRole('button', { name: /Simpan versi/ }));
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();

    // Open version 1
    const openButtons = screen.getAllByRole('button', { name: 'Buka' });
    await user.click(openButtons[openButtons.length - 1]);
    expect(await screen.findByText('Versi 1 dibuka.')).toBeVisible();
    expect(screen.getByLabelText('Nama pakaian')).toHaveValue('Kemeja Petualang');
  });

  it('handles keyboard shortcuts for render and save', async () => {
    window.location.hash = '#clothing';
    const user = userEvent.setup();
    render(<ClothingPage />);

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText('Pratinjau selesai.')).toBeVisible();

    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();
  });
});
