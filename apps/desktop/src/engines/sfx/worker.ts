import type { SfxRecipe } from '@forgekit/contracts';
import type { SynthesizedAudio } from './dsp';

export function synthesizeSfxAsync(recipe: SfxRecipe, signal: AbortSignal): Promise<SynthesizedAudio> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Sintesis dibatalkan.', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./sfx.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(new DOMException('Sintesis dibatalkan.', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('Sintesis melewati batas waktu 10 detik.'));
    }, 10000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: SynthesizedAudio; error?: string }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Hasil sintesis tidak tersedia.'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Worker audio berhenti. Ulangi sintesis.'));
    };
    try {
      worker.postMessage(recipe);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
