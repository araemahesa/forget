import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StudioExplorer } from './StudioExplorer';
import { call } from '../../services/tauri';
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
vi.mock('../../services/studioState', () => ({ useStudioSnapshot: () => ({ studio: { studioId: 'map-one', name: 'Test map' } }) }));
const node = (id: string, name = 'Folder.with.dots', childCount = 1) => ({ id, name, className: 'Folder', childCount, displayPath: `Workspace.${name}`, path: [{ id, name }] });
beforeEach(() => vi.mocked(call).mockReset().mockImplementation(async (_command, args) => {
  if (_command !== 'read_studio_explorer') return {};
  const q = args.query as { action: string; path: unknown[]; search: string };
  return { epoch: 'edit-one', nodes: q.action === 'properties' ? [] : q.path.length ? [] : [node('a'), node('b')], total: q.path.length ? 0 : 2, properties: q.action === 'properties' ? { Name: 'Folder.with.dots', Parent: 'Workspace' } : {}, partial: false };
}));
it('automatically reads the verified map and distinguishes duplicate dotted names by stable IDs', async () => {
  render(<StudioExplorer />);
  expect(await screen.findByRole('complementary', { name: 'Explorer dan Properties' })).toBeVisible();
  await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(2));
  fireEvent.click(screen.getAllByRole('treeitem')[1]);
  await screen.findByText('Name', { selector: 'dt' });
  expect(call).toHaveBeenCalledWith('read_studio_explorer', expect.objectContaining({ studioId: 'map-one', query: expect.objectContaining({ action: 'properties', path: [{ id: 'b', name: 'Folder.with.dots' }] }) }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Buka Folder.with.dots' })[1]);
  expect(await screen.findByText('Kosong')).toBeVisible();
});
it('virtualizes large root lists rather than rendering every instance', async () => {
  vi.mocked(call).mockResolvedValue({ epoch: 'edit-one', nodes: Array.from({ length: 450 }, (_, i) => node(`id-${i}`, `Part-${i}`, 0)), total: 450, partial: false });
  render(<StudioExplorer />);
  await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(65));
  fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 12000 } });
  expect(screen.queryByText('Part-0', { exact: true })).toBeNull();
  expect(screen.getByText('Part-375', { exact: true })).toBeVisible();
});
it('keeps loaded pages when the same branch refreshes', async () => {
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command !== 'read_studio_explorer') return {};
    const q = args?.query as {offset:number};
    return {epoch:'edit-one',nodes:Array.from({length:100},(_,i)=>node(`id-${q.offset+i}`,`Part-${q.offset+i}`,0)),total:250,more:true,partial:false};
  });
  render(<StudioExplorer />);
  await screen.findByText('100 / 250 root termuat · cabang dimuat saat dibuka');
  fireEvent.scroll(screen.getByRole('tree'), {target:{scrollTop:3000}});
  fireEvent.click(screen.getByRole('button',{name:'Muat berikutnya'}));
  await screen.findByText('200 / 250 root termuat · cabang dimuat saat dibuka');
  fireEvent.focus(window);
  await waitFor(()=>expect(call).toHaveBeenCalledTimes(4));
  expect(screen.getByText('200 / 250 root termuat · cabang dimuat saat dibuka')).toBeVisible();
});
it('focuses the narrow drawer and restores its toggle when Escape closes it', async () => {
  render(<StudioExplorer />);
  const input = await screen.findByRole('textbox',{name:'Cari objek map'});
  expect(input).toHaveFocus();
  fireEvent.keyDown(input,{key:'Escape'});
  expect(screen.queryByRole('complementary',{name:'Explorer dan Properties'})).toBeNull();
  expect(screen.getByRole('button',{name:'Explorer map bersama'})).toHaveFocus();
});
