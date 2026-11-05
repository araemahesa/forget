import { call } from './tauri';
import type { FeatureChoiceSnapshot } from './featureSelection';
export type EditorKind = 'gfx' | 'icon' | 'clothing' | 'texture' | 'sfx';
export async function generateEditorRecipe<T>(input: { kind: EditorKind; prompt: string; choiceSnapshot: FeatureChoiceSnapshot; currentSpec?: T; taskId: string }) {
  const choice = input.choiceSnapshot;
  if (!choice.providerId || !choice.modelId || choice.isLocal) throw new Error('Pilih akun provider dan model sebelum menyusun desain.');
  return call<{ spec: T; taskId: string; source: string; provider?: { adapterId: string; modelId: string } }>('generate_editor_recipe', {
    taskId: input.taskId, kind: input.kind, prompt: input.prompt, providerId: choice.providerId,
    modelId: choice.modelId, reasoningEffort: choice.reasoningEffort, currentSpec: input.currentSpec ?? null,
  });
}
