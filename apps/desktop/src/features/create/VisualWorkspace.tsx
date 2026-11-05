import type { WorkspacePageProps } from '../../app/featureRegistry';
import { GfxPage } from '../gfx/GfxPage';
import { IconsPage } from '../icons/IconsPage';
import { ClothingPage } from '../clothing/ClothingPage';
import { EditorModes } from './EditorModes';

export function VisualWorkspace({ mode }: WorkspacePageProps) {
  return <EditorModes label="Desain Visual" mode={mode} modes={{ gfx: 'GFX', thumbnail: 'Thumbnail', icon: 'Ikon', clothing: 'Pakaian klasik' }}
    keyFor={(id) => id === 'thumbnail' ? 'gfx' : id}
    render={(id) => id === 'icon' ? <IconsPage /> : id === 'clothing' ? <ClothingPage /> : <GfxPage />} />;
}
