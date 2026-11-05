import { synthesizeSfx } from './dsp';
import type { SfxRecipe } from '@forgekit/contracts';

self.onmessage = (event: MessageEvent<SfxRecipe>) => {
  try {
    const result = synthesizeSfx(event.data);
    self.postMessage({ result }, { transfer: [result.samples.buffer, result.wavBytes.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Sintesis gagal.' });
  }
};
