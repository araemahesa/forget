import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({isTauri: () => true}));
vi.mock('./tauri', () => ({probeStudio:vi.fn(),readStudio:vi.fn(),captureStudioContext:vi.fn()}));
beforeEach(() => {vi.resetModules();vi.clearAllMocks();});
it('does not expose a connected Studio without a verified place as an available map', async () => {
 const api=await import('./tauri');
 vi.mocked(api.probeStudio).mockResolvedValue({studios:[{studioId:'studio',name:'',placeId:null}],checkedAt:'1',executable:'',protocolVersion:'',serverName:'',readTools:[]});
 vi.mocked(api.readStudio).mockResolvedValue({isError:true,content:[{text:'Place is not open'}]});
 const state=await import('./studioState');
 expect(await state.refreshStudioContext()).toBeNull();expect(state.getStudioSnapshot()).toBeNull();expect(api.captureStudioContext).not.toHaveBeenCalled();
});
it('preserves the verified target and context during an active task without retargeting', async () => {
 const api=await import('./tauri');
 vi.mocked(api.probeStudio).mockResolvedValue({studios:[{studioId:'studio',name:'Map',placeId:1}],checkedAt:'1',executable:'',protocolVersion:'',serverName:'',readTools:[]});
 vi.mocked(api.readStudio).mockResolvedValue({content:[{text:'Current Studio Mode: Edit'}]});
 vi.mocked(api.captureStudioContext).mockRejectedValue(new Error('Optional bounded context unavailable'));
 const state=await import('./studioState');
 const before=await state.refreshStudioContext();expect(before?.studio.studioId).toBe('studio');
 const release=state.acquireStudioTask();
 expect(await state.refreshStudioContext()).toBe(before);expect(api.readStudio).toHaveBeenCalledTimes(1);
 vi.mocked(api.probeStudio).mockResolvedValue({studios:[{studioId:'another',name:'Other map',placeId:2}],checkedAt:'2',executable:'',protocolVersion:'',serverName:'',readTools:[]});
 expect(await state.refreshStudioContext()).toBeNull();release();
});
