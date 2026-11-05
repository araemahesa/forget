import { selectChoice } from '../../tests/selectChoice';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SfxPage } from './SfxPage';
import { synthesizeSfx } from '../../engines/sfx/dsp';
import { listSfxVersions, saveSfxVersion, loadSfxVersion, exportSfxVersion, type SavedSfxVersion } from '../../services/sfx';
import { synthesizeSfxAsync } from '../../engines/sfx/worker';

vi.mock('../../services/sfx', () => ({
  listSfxVersions: vi.fn(), saveSfxVersion: vi.fn(), loadSfxVersion: vi.fn(), exportSfxVersion: vi.fn(),
}));
vi.mock('../../engines/sfx/worker', () => ({ synthesizeSfxAsync: vi.fn() }));
vi.mock('../shared/ObsidianContext', () => ({ ObsidianContext: () => null }));
let saved: SavedSfxVersion[] = [];

class MockAudio {
  src = '';
  loop = false;
  currentTime = 0;
  onended: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  vi.mocked(listSfxVersions).mockResolvedValue([]);
  vi.mocked(synthesizeSfxAsync).mockImplementation(async (recipe) => synthesizeSfx(recipe));
  vi.mocked(saveSfxVersion).mockImplementation(async (recipe, wavBytes) => {
    const version = { id: `sfx-${saved.length + 1}`, sequence: saved.length + 1, recipe: { ...recipe }, sha256: 'test-only', byteLength: wavBytes.length, createdAt: '0' };
    saved.push(version); return version;
  });
  vi.mocked(loadSfxVersion).mockImplementation(async (id) => {
    const version = saved.find((v) => v.id === id)!;
    return { version, wavBytes: Array.from(synthesizeSfx(version.recipe).wavBytes) };
  });
  vi.mocked(exportSfxVersion).mockResolvedValue({ relativePath: 'exports/sfx-1.wav', byteLength: 17684, sha256: 'test-only' });
  vi.stubGlobal('Audio', MockAudio);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.location.hash = '#create/audio';
});

describe('SfxPage', () => {
  it('regenerates edited parameters before keyboard save and never autoplays', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('Audio', class extends MockAudio { play = play; });
    const user = userEvent.setup();
    render(<SfxPage />);
    await user.click(screen.getByRole('button', { name: /Sintesis/ }));
    const frequency = screen.getByLabelText('Frekuensi awal (Hz)');
    await user.clear(frequency);
    await user.type(frequency, '900');
    expect(document.querySelector('.sfx-waveform-display')).toBeNull();
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();
    const [recipe, bytes] = vi.mocked(saveSfxVersion).mock.calls[0];
    expect(recipe.frequencyStart).toBe(900);
    expect(bytes).toEqual(synthesizeSfx(recipe).wavBytes);
    expect(play).not.toHaveBeenCalled();
  });

  it('preserves draft on native failure and reports unavailable history', async () => {
    vi.mocked(listSfxVersions).mockRejectedValue(new Error('Database tidak dapat dibaca'));
    vi.mocked(saveSfxVersion).mockRejectedValue(new Error('Disk penuh'));
    const user = userEvent.setup();
    render(<SfxPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Database tidak dapat dibaca');
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Disk penuh')).toBeVisible();
    expect(screen.getByLabelText('Nama efek suara')).toHaveValue('Tembakan Laser Sci-Fi');
    expect(screen.queryByText('Versi 1 tersimpan')).toBeNull();
  });

  it('cancels pending synthesis and unlocks fields without creating a version', async () => {
    vi.mocked(synthesizeSfxAsync).mockImplementation((_recipe, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const user = userEvent.setup();
    render(<SfxPage />);
    await user.click(screen.getByRole('button', { name: /Sintesis/ }));
    expect(screen.getByLabelText('Nama efek suara')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Batalkan sintesis' }));
    expect(await screen.findByText('Sintesis dibatalkan.')).toBeVisible();
    expect(screen.getByLabelText('Nama efek suara')).toBeEnabled();
    expect(saveSfxVersion).not.toHaveBeenCalled();
  });

  it('reloads native history after remount and exports actual saved identity', async () => {
    const user = userEvent.setup();
    const first = render(<SfxPage />);
    await user.keyboard('{Control>}s{/Control}');
    await screen.findByText('Versi 1 disimpan.');
    first.unmount();
    vi.mocked(listSfxVersions).mockResolvedValue([...saved]);
    render(<SfxPage />);
    await user.click(await screen.findByRole('button', { name: 'Buka' }));
    await screen.findByText('Versi 1 dibuka.');
    await user.click(screen.getByRole('button', { name: /Ekspor WAV/ }));
    await waitFor(() => expect(exportSfxVersion).toHaveBeenCalledWith('sfx-1'));
    expect(saveSfxVersion).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/WAV diekspor: exports\/sfx-1.wav/)).toBeVisible();
  });

  it('renders page header and initial controls', () => {
    render(<SfxPage />);
    expect(screen.getByRole('heading', { name: 'Generator Efek Suara' })).toBeVisible();
    expect(screen.getByLabelText('Nama efek suara')).toHaveValue('Tembakan Laser Sci-Fi');
    expect(screen.getByRole('button', { name: /Sintesis/ })).toBeVisible();
    expect(screen.getByText('Draf belum disintesis.')).toBeVisible();
    expect((document.getElementById('sfx-brief') as HTMLFormElement).checkValidity()).toBe(true);
  });

  it('synthesizes audio and displays waveform and analysis', async () => {
    const user = userEvent.setup();
    render(<SfxPage />);

    await user.click(screen.getByRole('button', { name: /Sintesis/ }));

    expect(await screen.findByText(/Sintesis efek suara "Tembakan Laser Sci-Fi" selesai\./)).toBeVisible();
    expect(document.querySelector('.sfx-waveform-display svg')).not.toBeNull();
    expect(screen.getByText(/dBFS/)).toBeVisible();
    expect(screen.getByText('Format WAV')).toBeVisible();
  });

  it('updates parameters when selecting a different preset', async () => {
    const user = userEvent.setup();
    render(<SfxPage />);

    const categorySelect = screen.getByLabelText('Kategori preset');
    await selectChoice(categorySelect, 'coin');

    expect(screen.getByLabelText('Frekuensi awal (Hz)')).toHaveValue(987);
    expect(screen.getByLabelText('Frekuensi akhir (Hz)')).toHaveValue(1318);
  });

  it('randomizes seed when clicking Acak', async () => {
    const user = userEvent.setup();
    render(<SfxPage />);

    await user.click(screen.getByText('Envelope & variasi lanjutan'));
    const seedInput = screen.getByLabelText('Seed pengacakan');
    const initialSeed = seedInput.getAttribute('value');

    await user.click(screen.getByRole('button', { name: /Acak/ }));
    const newSeed = seedInput.getAttribute('value');
    expect(newSeed).not.toBe(initialSeed);
  });

  it('saves and opens versions', async () => {
    const user = userEvent.setup();
    render(<SfxPage />);

    await user.click(screen.getByRole('button', { name: /Sintesis/ }));
    const saveButton = screen.getByRole('button', { name: /Simpan versi/ });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();

    // Modify name
    const nameInput = screen.getByLabelText('Nama efek suara');
    await user.clear(nameInput);
    await user.type(nameInput, 'Laser Modifikasi');
    expect(screen.getByText('Draf berubah')).toBeVisible();

    // Synthesize & save version 2
    await user.click(screen.getByRole('button', { name: /Sintesis/ }));
    await user.click(screen.getByRole('button', { name: /Simpan versi/ }));
    expect(await screen.findByText('Versi 2 disimpan.')).toBeVisible();

    // Open version 1
    const openButtons = screen.getAllByRole('button', { name: 'Buka' });
    await user.click(openButtons[openButtons.length - 1]);
    expect(await screen.findByText('Versi 1 dibuka.')).toBeVisible();
    expect(screen.getByLabelText('Nama efek suara')).toHaveValue('Tembakan Laser Sci-Fi');
  });

  it('handles keyboard shortcuts for synthesize and save', async () => {
    window.location.hash = '#create/audio';
    const user = userEvent.setup();
    render(<SfxPage />);

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText(/Sintesis efek suara "Tembakan Laser Sci-Fi" selesai\./)).toBeVisible();

    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versi 1 disimpan.')).toBeVisible();
  });
});
