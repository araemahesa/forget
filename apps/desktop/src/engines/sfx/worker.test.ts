import { afterEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSfxAsync } from './worker';
import { sfxPresets, synthesizeSfx } from './dsp';

const recipe = { name: 'Worker check', ...sfxPresets.laser, seed: 42 };

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); TestWorker.instances = []; });

describe('SFX worker lifecycle', () => {
  it('terminates after result and does not react to later abort', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const controller = new AbortController();
    const pending = synthesizeSfxAsync(recipe, controller.signal);
    const worker = TestWorker.instances[0];
    const result = synthesizeSfx(recipe);
    worker.onmessage?.({ data: { result } });
    expect(await pending).toBe(result);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith(recipe);
  });

  it('terminates on cancel and never starts for an aborted request', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const controller = new AbortController();
    const pending = synthesizeSfxAsync(recipe, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    await expect(synthesizeSfxAsync(recipe, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.instances).toHaveLength(1);
  });

  it('terminates stalled and crashed workers', async () => {
    vi.stubGlobal('Worker', TestWorker);
    vi.useFakeTimers();
    const pending = synthesizeSfxAsync(recipe, new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow('10 detik');
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const crashed = synthesizeSfxAsync(recipe, new AbortController().signal);
    TestWorker.instances[1].onerror?.();
    await expect(crashed).rejects.toThrow('Worker audio berhenti');
    expect(TestWorker.instances[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when sending input fails', async () => {
    vi.stubGlobal('Worker', class extends TestWorker {
      postMessage = vi.fn(() => { throw new Error('Clone failed'); });
    });
    await expect(synthesizeSfxAsync(recipe, new AbortController().signal)).rejects.toThrow('Clone failed');
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
