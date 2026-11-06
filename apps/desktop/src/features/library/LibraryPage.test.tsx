import { selectChoice } from '../../tests/selectChoice';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { LibraryPage } from './LibraryPage';
import { listLibrary, setLibraryDeleted, type LibraryEntry } from '../../services/creatorWorkspace';
import { loadImageVersion, exportImageArtifact } from '../../services/images';
import { loadSfxVersion } from '../../services/sfx';
import { flushPendingDraft } from '../gfx/useGfxDraft';

vi.mock('../../services/creatorWorkspace', async (load) => ({
  ...await load<typeof import('../../services/creatorWorkspace')>(),
  listLibrary: vi.fn(), setLibraryDeleted: vi.fn(),
}));
vi.mock('../../services/images', () => ({ loadImageVersion: vi.fn(), exportImageArtifact: vi.fn() }));
vi.mock('../../services/sfx', () => ({ loadSfxVersion: vi.fn(), exportSfxVersion: vi.fn() }));
vi.mock('../../services/tauri', () => ({ loadGfxVersion: vi.fn(), exportGfxArtifact: vi.fn() }));
vi.mock('../../services/creatorTasks', () => ({
  runCreatorTask: vi.fn(async (_kind, _action, _input, _controller, operation) => operation({ checkpoint: vi.fn() })),
}));

const entry = (kind: LibraryEntry['kind']): LibraryEntry => ({
  id: `${kind}-1`, kind, name: `Stored ${kind}`, sequence: 1, createdAt: '1793000000000', deletedAt: null,
});
const image = (id: string) => ({
  version: { id, document: { kind: 'icon', spec: { name: id } }, artifacts: [
    { name: 'icon', format: 'png', sha256: 'verified-hash', byteLength: 123, relativePath: 'artifacts/icon.png' },
  ] }, svgs: { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listLibrary).mockResolvedValue(['gfx', 'sfx', 'icon', 'texture', 'clothing'].map((kind) => entry(kind as LibraryEntry['kind'])));
  vi.mocked(loadImageVersion).mockImplementation(async (id) => image(id) as never);
  vi.mocked(setLibraryDeleted).mockResolvedValue(undefined);
  vi.mocked(exportImageArtifact).mockResolvedValue({ relativePath: 'exports/icon.png', sha256: 'verified-hash', byteLength: 123 });
});

it('lists five kinds, loads verified details, exports and opens correct editor', async () => {
  const onOpen = vi.fn();
  render(<LibraryPage onOpen={onOpen} />);
  await screen.findByText('Stored icon');
  expect(screen.getAllByRole('button', { name: /Stored/ })).toHaveLength(5);
  await userEvent.click(screen.getByRole('button', { name: /Stored icon/ }));
  const detail = screen.getByLabelText('Detail versi');
  expect(await within(detail).findByAltText('Pratinjau Stored icon')).toBeVisible();
  await userEvent.click(within(detail).getByRole('button', { name: 'Ekspor artefak' }));
  expect(await screen.findByText('Diekspor: exports/icon.png (123 byte).')).toBeVisible();
  expect(exportImageArtifact).toHaveBeenCalledWith('icon-1', 'icon', 'png');
  await userEvent.click(within(detail).getByRole('button', { name: 'Buka di editor' }));
  expect(onOpen).toHaveBeenCalledWith('icon-1', 'icon');
});

it('passes search/type/trash filters and reversibly hides selected version', async () => {
  render(<LibraryPage onOpen={vi.fn()} />);
  await screen.findByRole('button', { name: /Stored icon/ });
  await userEvent.type(screen.getByRole('textbox', { name: 'Cari koleksi' }), 'Stored');
  await selectChoice(screen.getByRole('combobox', { name: 'Jenis' }), 'icon');
  await waitFor(() => expect(listLibrary).toHaveBeenLastCalledWith('Stored', 'icon', false, 0));
  await userEvent.click(screen.getByRole('button', { name: /Stored icon/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Pindahkan ke Sampah' }));
  expect(setLibraryDeleted).toHaveBeenCalledWith('icon', 'icon-1', true);
  await userEvent.click(screen.getByRole('button', { name: 'Sampah' }));
  await waitFor(() => expect(listLibrary).toHaveBeenLastCalledWith('Stored', 'icon', true, 0));
  await userEvent.click(await screen.findByRole('button', { name: /Stored icon/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan versi' }));
  expect(setLibraryDeleted).toHaveBeenLastCalledWith('icon', 'icon-1', false);
});

it('rejects stale detail responses and blocks export of corrupt artifact', async () => {
  let finish!: (value: never) => void;
  vi.mocked(loadImageVersion).mockImplementation((id) => id === 'icon-1'
    ? new Promise((resolve) => { finish = resolve; })
    : Promise.reject(new Error('Hash artefak tidak cocok')));
  render(<LibraryPage onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: /Stored icon/ }));
  await userEvent.click(screen.getByRole('button', { name: /Stored texture/ }));
  const detail = screen.getByLabelText('Detail versi');
  expect(await within(detail).findByRole('alert')).toHaveTextContent('Hash artefak tidak cocok');
  finish(image('icon-1') as never);
  await waitFor(() => expect(within(detail).queryByAltText('Pratinjau Stored icon')).toBeNull());
  expect(within(detail).getByRole('button', { name: 'Ekspor artefak' })).toBeDisabled();
});

it('keeps close/backup guard while export continues after leaving Library', async () => {
  let finish!: (value: never) => void;
  vi.mocked(exportImageArtifact).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const page = render(<LibraryPage onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: /Stored icon/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ekspor artefak' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Ekspor artefak' }));
  page.unmount();
  await expect(flushPendingDraft()).rejects.toThrow('Operasi Library masih berjalan');
  finish({ relativePath: 'exports/icon.png', byteLength: 123, sha256: 'verified-hash' } as never);
  await waitFor(async () => { await expect(flushPendingDraft()).resolves.toBeUndefined(); });
});

it('derives finite SFX waveform from stored WAV samples without autoplay', async () => {
  const buffer = new ArrayBuffer(52);
  const data = new DataView(buffer);
  [-32768, 16384, 8192, -4096].forEach((sample, index) => data.setInt16(44 + index * 2, sample, true));
  vi.mocked(loadSfxVersion).mockResolvedValue({
    version: { recipe: { name: 'sound' }, sha256: 'audio-hash', byteLength: 52 }, wavBytes: [...new Uint8Array(buffer)],
  } as never);
  render(<LibraryPage onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: /Stored sfx/ }));
  const preview = await within(screen.getByLabelText('Detail versi')).findByAltText('Pratinjau Stored sfx');
  const svg = decodeURIComponent(preview.getAttribute('src')!.split(',')[1]);
  expect(svg).toContain('<path');
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(document.querySelector('audio')).toBeNull();
});
