import type { WorkspacePageProps } from '../../app/featureRegistry';
import { Texture3dPage } from '../model3d/Texture3dPage';
import { TexturesPage } from '../textures/TexturesPage';
import { EditorModes } from './EditorModes';

export function MaterialWorkspace({ mode }: WorkspacePageProps) {
  return <EditorModes label="Material & Tekstur" mode={mode} modes={{ material: 'Material', texture: 'Tekstur prosedural' }}
    render={(id) => id === 'texture' ? <TexturesPage /> : <Texture3dPage />} />;
}
