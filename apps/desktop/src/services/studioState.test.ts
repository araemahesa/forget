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
const report=(studios:{studioId:string;name:string;placeId:number}[])=>({studios:studios.map(s=>({...s,target:{}})),checkedAt:'1',executable:'',protocolVersion:'',serverName:'',readTools:[]}) as never;
it('probes again after selecting a map while an older probe is still in flight', async () => {
 const api=await import('./tauri');
 const two=[{studioId:'a',name:'Map A',placeId:1},{studioId:'b',name:'Map B',placeId:2}];
 vi.mocked(api.probeStudio).mockResolvedValue(report(two));
 vi.mocked(api.captureStudioContext).mockRejectedValue(new Error('Tanpa konteks'));
 const state=await import('./studioState');
 await state.refreshStudioContext();
 let finish!:(value:unknown)=>void;
 vi.mocked(api.probeStudio).mockReturnValueOnce(new Promise(r=>{finish=r;}) as never);
 const stale=state.refreshStudioContext();
 state.selectStudioTarget('b');
 finish(report(two));
 await stale;
 await vi.waitFor(()=>expect(state.getStudioSnapshot()?.studio.studioId).toBe('b'));
 expect(api.probeStudio).toHaveBeenCalledTimes(3);
});
it('runs a single polling loop after a StrictMode stop and restart', async () => {
 vi.useFakeTimers();
 try {
  const api=await import('./tauri');
  let finish!:(value:unknown)=>void;
  vi.mocked(api.probeStudio).mockReturnValueOnce(new Promise(r=>{finish=r;}) as never).mockResolvedValue(report([]));
  const state=await import('./studioState');
  const stop=state.startStudioDiscovery(); stop();
  const stopAgain=state.startStudioDiscovery();
  finish(report([]));
  await vi.advanceTimersByTimeAsync(0);
  const afterStart=vi.mocked(api.probeStudio).mock.calls.length;
  await vi.advanceTimersByTimeAsync(8000);
  expect(vi.mocked(api.probeStudio).mock.calls.length-afterStart).toBe(1);
  stopAgain();
  await vi.advanceTimersByTimeAsync(16000);
  expect(vi.mocked(api.probeStudio).mock.calls.length-afterStart).toBe(1);
 } finally { vi.useRealTimers(); }
});
