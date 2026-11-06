// Explicit DOM-test doubles. Native restart/export tests exercise the real services.
import { vi } from 'vitest';
import { exportImageArtifact, listImageVersions, loadImageVersion, saveImageVersion, renderImageDocument, type ImageVersion } from '../../services/images';

vi.mock('../../services/images', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/images')>(),
  listImageVersions: vi.fn(), saveImageVersion: vi.fn(), loadImageVersion: vi.fn(), exportImageArtifact: vi.fn(),
}));

export let imageVersions: ImageVersion[] = [];

export function resetImageMocks() {
  vi.clearAllMocks();
  imageVersions = [];
  vi.mocked(listImageVersions).mockImplementation(async (kind) => imageVersions.filter((v) => v.document.kind === kind).slice().reverse());
  vi.mocked(saveImageVersion).mockImplementation(async (document, images) => {
    const sequence = imageVersions.filter((v) => v.document.kind === document.kind).length + 1;
    const version: ImageVersion = {
      id: `${document.kind}-${sequence}`, sequence, document: structuredClone(document), createdAt: '0',
      artifacts: images.flatMap((image) => (['svg', 'png'] as const).map((format) => ({
        name: image.name, format, relativePath: `test/${image.name}.${format}`, byteLength: 1, sha256: 'test-only',
      }))),
    };
    imageVersions.push(version);
    return version;
  });
  vi.mocked(loadImageVersion).mockImplementation(async (id) => {
    const version = imageVersions.find((v) => v.id === id)!;
    return { version, svgs: Object.fromEntries(renderImageDocument(version.document).images.map((image) => [image.name, image.svg])) };
  });
  vi.mocked(exportImageArtifact).mockImplementation(async (_id, name, format) => ({
    relativePath: `exports/test-${name}.${format}`, sha256: 'test-only', byteLength: 1,
  }));
}
