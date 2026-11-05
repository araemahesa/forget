import type { MusicRecipe } from '@forgekit/contracts';
import { synthesizeMusic } from './render';

self.onmessage = (event: MessageEvent<MusicRecipe>) => {
  try {
    const result = synthesizeMusic(event.data);
    self.postMessage({ result }, { transfer: [result.samples.buffer, result.wavBytes.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Sintesis musik gagal.' });
  }
};
