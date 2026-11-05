import type { WorkspacePageProps } from '../../app/featureRegistry';
import { SfxPage } from '../sfx/SfxPage';
import { MusicPage } from '../motionAudio/MusicPage';
import { EditorModes } from './EditorModes';

export function AudioWorkspace({ mode }: WorkspacePageProps) {
  return <EditorModes label="Audio" mode={mode} modes={{ sfx: 'Efek suara', music: 'Musik' }}
    render={(id) => id === 'music' ? <MusicPage /> : <SfxPage />} />;
}
