import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCreativeTask } from './useCreativeTask';
import { call } from '../../services/tauri';
vi.mock('../../services/tauri', () => ({ call: vi.fn() }));
const selectionState = vi.hoisted(() => ({ fallbackNotice: '' }));
vi.mock('../../services/featureSelection', () => ({ getFeatureChoice: () => 'account', useFeatureProviderSelection: () => ({ profiles: [], fallbackNotice: selectionState.fallbackNotice, modelSelection: { provider: { id: 'account' } }, snapshot: vi.fn(() => ({providerId: 'account', modelId: 'fixture-model', reasoningEffort: 'high'})) }) }));
vi.mock('../../services/studioState', () => ({ acquireStudioTask: () => vi.fn(), refreshStudioContext: vi.fn() }));
vi.mock('../../services/providerUsage', () => ({ refreshUsageAfterTask: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); selectionState.fallbackNotice = ''; });
it('restores and cancels the same journal task after navigation without generating again', async () => {
  localStorage.setItem('forgekit:creative-task:model3d', 'saved-task');
  vi.mocked(call).mockImplementation(async (command) => command === 'get_creative_task' ? { id: 'saved-task', status: 'planning', versionId: null } : []);
  const { result } = renderHook(() => useCreativeTask('model3d'));
  await waitFor(() => expect(result.current.busy).toBe(true));
  expect(result.current.attemptTaskId).toBe('saved-task');
  await act(async () => { await result.current.run('Do not duplicate', null); await result.current.stop(); });
  expect(call).toHaveBeenCalledWith('cancel_creative', { id: 'saved-task' });
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'generate_creative')).toBe(false);
});

it('ends restored progress when a committed artifact cannot be opened', async () => {
  localStorage.setItem('forgekit:creative-task:model3d', 'saved-task');
  let reads = 0;
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === 'get_creative_task') return { id: 'saved-task', status: ++reads === 1 ? 'planning' : 'completed', versionId: 'broken-version' };
    if (command === 'load_creative_version') throw new Error('Artefak tidak dapat dibaca');
    return [];
  });
  const { result } = renderHook(() => useCreativeTask('model3d'));
  await waitFor(() => expect(result.current.error).toBe('Artefak tidak dapat dibaca'));
  expect(result.current.busy).toBe(false);
  expect(result.current.task?.status).toBe('completed');
});

it('keeps a new tab empty and restores only its own task rather than the legacy task', async () => {
  localStorage.setItem('forgekit:creative-task:model3d', 'legacy-task');
  localStorage.setItem('forgekit:creative-task:model3d:tab-b', 'tab-b-task');
  vi.mocked(call).mockImplementation(async (command, args) => command === 'get_creative_task'
    ? { id: args.id, status: 'failed', error: '[REQUEST_TIMEOUT] fixture', versionId: null } : []);
  const first = renderHook(() => useCreativeTask('model3d', { id: 'tab-a' }));
  const second = renderHook(() => useCreativeTask('model3d', { id: 'tab-b' }));
  await waitFor(() => expect(second.result.current.error).toContain('[REQUEST_TIMEOUT]'));
  expect(first.result.current.attemptTaskId).toBeNull();
  expect(first.result.current.version).toBeNull();
  expect(second.result.current.attemptTaskId).toBe('tab-b-task');
  expect(first.result.current.storageKey).toBe('model3d:tab-a');
  expect(second.result.current.storageKey).toBe('model3d:tab-b');
  expect(vi.mocked(call).mock.calls.some(([command, args]) => command === 'get_creative_task' && args.id === 'legacy-task')).toBe(false);
  expect(vi.mocked(call).mock.calls.some(([command]) => command === 'generate_creative')).toBe(false);
});

it('restores the completed version belonging to its tab and does not load the latest unrelated model', async () => {
  const saved = { id: 'own-model', taskId: 'own-task', parentVersionId: null, engineVersion: 1, artifact: { relativePath: 'own.json', sha256: 'fixture', byteLength: 1 }, createdAt: '1', document: { kind: 'model3d', recipe: { name: 'Own model', category: 'prop', seed: 1, exportFormat: 'blend', parts: [{ id: 'cube', name: 'Cube', primitive: 'cube', position: [0,0,0], size: [1,1,1], rotation: [0,0,0], color: '#FF0033', material: 'Plastic' }] } } };
  localStorage.setItem('forgekit:creative-task:model3d:own-tab', 'own-task');
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === 'list_creative_versions') return [{ ...saved, id: 'unrelated-latest' }];
    if (command === 'get_creative_task') return { id: args.id, status: 'preview_ready', versionId: saved.id };
    if (command === 'load_creative_version') return saved;
    return null;
  });
  const { result } = renderHook(() => useCreativeTask('model3d', { id: 'own-tab' }));
  await waitFor(() => expect(result.current.version?.id).toBe('own-model'));
  expect(vi.mocked(call).mock.calls.some(([command, args]) => command === 'load_creative_version' && args.id === 'unrelated-latest')).toBe(false);
});

it('sends an image-only model request without inventing a user prompt or generating from nonvisual files', async () => {
  vi.mocked(call).mockImplementation(async command => {
    if (command === 'generate_creative') throw new Error('Fixture stopped before inference');
    return [];
  });
  const {result}=renderHook(()=>useCreativeTask('model3d',{id:'image-tab'}));
  await act(async()=>{result.current.setReferenceImages([{name:'shape.png',dataUrl:'data:image/png;base64,fixture'}]);});
  await act(async()=>{await result.current.run('',null);});
  expect(call).toHaveBeenCalledWith('generate_creative',expect.objectContaining({request:expect.objectContaining({prompt:'',quality:'high',providerId:'account',modelId:'fixture-model',referenceImages:[{name:'shape.png',dataUrl:'data:image/png;base64,fixture'}]})}));
  vi.mocked(call).mockClear();
  await act(async()=>{result.current.setReferenceImages([{name:'notes.txt',kind:'text',text:'data'}]);});
  await act(async()=>{await result.current.run('',null);});
  expect(result.current.error).toBe('Isi prompt terlebih dahulu.');
  expect(call).not.toHaveBeenCalledWith('generate_creative',expect.anything());
});
it('does not start an image request while attachment processing is active', async()=>{
  vi.mocked(call).mockResolvedValue([]);
  const {result}=renderHook(()=>useCreativeTask('model3d',{id:'reading-tab'}));
  await act(async()=>{result.current.setReferenceImages([{name:'shape.png',dataUrl:'data:image/png;base64,fixture'}]);result.current.setAttachmentsBusy(true);});
  await act(async()=>{await result.current.run('',null);});
  expect(result.current.error).toContain('selesai diproses');
  expect(call).not.toHaveBeenCalledWith('generate_creative',expect.anything());
});

it('clears the account fallback notice once the selection becomes valid again', async () => {
  vi.mocked(call).mockResolvedValue([]);
  selectionState.fallbackNotice = 'Akun pilihan sebelumnya tidak tersedia.';
  const { result, rerender } = renderHook(() => useCreativeTask('model3d', { id: 'notice-tab' }));
  await waitFor(() => expect(result.current.notice).toBe('Akun pilihan sebelumnya tidak tersedia.'));
  selectionState.fallbackNotice = ''; rerender();
  await waitFor(() => expect(result.current.notice).toBe(''));
});
