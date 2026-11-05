import type { ClothingSpec, IconSpec, TextureSpec, ValidationIssue } from '@forgekit/contracts';
import { renderIconSvg } from '../engines/icons/render';
import { renderTextureSvg } from '../engines/textures/render';
import { renderAvatarPreviewSvg, renderClothingTemplateSvg } from '../engines/clothing/render';
import { clothingDimensions } from '@forgekit/contracts';
import { call, type ArtifactExport } from './tauri';

export type ImageSpecs = { icon: IconSpec; texture: TextureSpec; clothing: ClothingSpec };
export type ImageKind = keyof ImageSpecs;
export type ImageDocument = { [K in ImageKind]: { kind: K; spec: ImageSpecs[K] } }[ImageKind];
export type ImageVersion = {
  id: string;
  sequence: number;
  document: ImageDocument;
  createdAt: string;
  artifacts: (ArtifactExport & { name: string; format: 'svg' | 'png' })[];
};
export type RenderedImage = { name: string; svg: string; width: number; height: number };

export function renderImageDocument(document: ImageDocument): { images: RenderedImage[]; issues: ValidationIssue[] } {
  switch (document.kind) {
    case 'icon': {
      const { svg, issues } = renderIconSvg(document.spec);
      return { images: [{ name: 'icon', svg, width: document.spec.size, height: document.spec.size }], issues };
    }
    case 'texture': {
      const { resolution } = document.spec;
      const maps = ['baseColor', 'normal', 'roughness', 'height'] as const;
      const results = maps.map((name) => ({ name, ...renderTextureSvg(document.spec, name, '1x1'), width: resolution, height: resolution }));
      return { images: results, issues: results[0].issues };
    }
    case 'clothing': {
      const template = renderClothingTemplateSvg(document.spec);
      return {
        images: [
          { name: 'template', svg: template.svg, ...clothingDimensions(document.spec.kind) },
          { name: 'avatar', svg: renderAvatarPreviewSvg(document.spec).svg, width: 320, height: 380 },
        ],
        issues: template.issues,
      };
    }
  }
}

export const listImageVersions = (kind: ImageKind) => call<ImageVersion[]>('list_image_versions', { kind });
export const saveImageVersion = (document: ImageDocument, images: { name: string; svg: string; pngBytes: number[] }[], workTaskId?: string) =>
  call<ImageVersion>('save_image_version', { document, images, workTaskId });
export const loadImageVersion = (id: string) =>
  call<{ version: ImageVersion; svgs: Record<string, string> }>('load_image_version', { id });
export const exportImageArtifact = (id: string, name: string, format: 'svg' | 'png') =>
  call<ArtifactExport>('export_image_artifact', { id, name, format });
