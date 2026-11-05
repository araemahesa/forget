import type { MusicRecipe } from '@forgekit/contracts';
import type { SynthesizedAudio } from '../sfx/dsp';

export function synthesizeMusicAsync(recipe: MusicRecipe, signal: AbortSignal): Promise<SynthesizedAudio> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Sintesis dibatalkan.', 'AbortError')); return; }
    const worker = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { finish(); reject(new DOMException('Sintesis dibatalkan.', 'AbortError')); };
    const timeout = setTimeout(() => { finish(); reject(new Error('Sintesis musik melewati batas 30 detik. Kurangi durasi atau jumlah nada.')); }, 30000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: SynthesizedAudio; error?: string }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Hasil sintesis tidak tersedia.'));
    };
    worker.onerror = () => { finish(); reject(new Error('Worker musik berhenti. Ulangi sintesis.')); };
    try { worker.postMessage(recipe); } catch (error) { finish(); reject(error); }
  });
}
