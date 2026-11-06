import type { ComponentType, RefObject } from 'react';
import type { IconName } from '../design-system/Icon';
import type { LibraryKind } from '../services/creatorWorkspace';
import type { useAppearance } from './useAppearance';

export type WorkspacePageProps = {
  mode?: string;
  section?: string;
  appearance: ReturnType<typeof useAppearance>;
  onOpenVersion: (id: string, kind: LibraryKind) => void;
  explorer?: { open: boolean; onToggle: () => void; triggerRef: RefObject<HTMLButtonElement | null> };
};
export type WorkspaceFeature = {
  id: string;
  label: string;
  route: string;
  icon: IconName;
  parent?: 'create';
  modes?: readonly string[];
  requirements: readonly string[];
  aliases: readonly string[];
  load: () => Promise<{ default: ComponentType<WorkspacePageProps> }>;
};

export const featureRegistry: readonly WorkspaceFeature[] = [
  { id: 'chat', label: 'AI Chat', route: 'chat', icon: 'message', requirements: [], aliases: ['workspace', 'create', 'world', 'place-tools', 'assets', 'experience', 'datastores', 'analytics', 'community', 'activity', 'terrain', 'city', 'doctor', 'mesh-optimizer', 'union-to-mesh', 'rig-weld', 'localization', 'uploader', 'downloader', 'library', 'create/material', 'texture3d', 'texture', 'textures'],
    load: () => import('../features/chat/ChatPage').then((m) => ({ default: m.ChatPage })) },
  { id: 'model3d', label: 'Model 3D', route: 'create/model-3d', icon: 'cube', parent: 'create', requirements: ['model-engine'], aliases: ['generator'],
    load: () => import('../features/model3d/Model3dPage').then((m) => ({ default: m.Model3dPage })) },
  { id: 'animation', label: 'Animasi', route: 'create/animation', icon: 'activity', parent: 'create', requirements: ['motion-engine'], aliases: ['animation'],
    load: () => import('../features/motionAudio/AnimationPage').then((m) => ({ default: m.AnimationPage })) },
  { id: 'vfx', label: 'Efek Visual', route: 'create/vfx', icon: 'spark', parent: 'create', requirements: ['effect-engine'], aliases: ['vfx'],
    load: () => import('../features/vfx/VfxPage').then((m) => ({ default: m.VfxPage })) },
  { id: 'visual', label: 'Desain Visual', route: 'create/visual', icon: 'image', parent: 'create', modes: ['gfx', 'thumbnail', 'icon', 'clothing'], requirements: ['visual-engine'], aliases: ['gfx', 'icons', 'clothing'],
    load: () => import('../features/create/VisualWorkspace').then((m) => ({ default: m.VisualWorkspace })) },
  { id: 'audio', label: 'Audio', route: 'create/audio', icon: 'wave', parent: 'create', modes: ['sfx', 'music'], requirements: ['audio-engine'], aliases: ['sfx', 'music'],
    load: () => import('../features/create/AudioWorkspace').then((m) => ({ default: m.AudioWorkspace })) },
  { id: 'cutscene', label: 'Cutscene', route: 'create/cutscene', icon: 'film', parent: 'create', requirements: ['timeline-engine'], aliases: ['cutscene'],
    load: () => import('../features/motionAudio/CutscenePage').then((m) => ({ default: m.CutscenePage })) },
  { id: 'interface', label: 'Antarmuka Game', route: 'create/interface', icon: 'panel', parent: 'create', requirements: ['ui-engine'], aliases: ['gui'],
    load: () => import('../features/gui/GuiPage').then((m) => ({ default: m.GuiPage })) },
  { id: 'npc', label: 'Karakter & Dialog', route: 'create/npc', icon: 'message', parent: 'create', requirements: ['dialogue-engine'], aliases: ['npc'],
    load: () => import('../features/npcDialogue/NpcDialoguePage').then((m) => ({ default: m.NpcDialoguePage })) },
  { id: 'sky', label: 'Langit & Atmosfer', route: 'create/sky', icon: 'sun', parent: 'create', requirements: ['sky-engine'], aliases: ['skybox', 'lighting'],
    load: () => import('../features/skybox/SkyboxPage').then((m) => ({ default: m.SkyboxPage })) },
  { id: 'settings', label: 'Pengaturan', route: 'settings', icon: 'settings', requirements: [], aliases: ['bridge'],
    load: () => import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })) },
];

export const creativeFeatures = featureRegistry.filter((feature) => feature.parent === 'create');
const legacyModes: Record<string, string> = {
  gfx: 'gfx', icons: 'icon', clothing: 'clothing', sfx: 'sfx', music: 'music',
};

export type WorkspaceRoute = { feature: WorkspaceFeature; mode?: string; section?: string; hash: string };
export function resolveRoute(hash: string): WorkspaceRoute {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const feature = featureRegistry.find((entry) => entry.route === path || entry.aliases.includes(path)) ?? featureRegistry[0];
  const params = new URLSearchParams(query);
  const requestedMode = legacyModes[path] ?? params.get('mode');
  const mode = feature.modes?.includes(requestedMode ?? '') ? requestedMode! : feature.modes?.[0];
  const requestedSection = params.get('section');
  const section = feature.id === 'settings' && ['account', 'providers', 'connectors', 'hunyuan', 'appearance'].includes(requestedSection ?? '') ? requestedSection! : undefined;
  const canonical = new URLSearchParams();
  if (mode && mode !== feature.modes?.[0]) canonical.set('mode', mode);
  if (section) canonical.set('section', section);
  return { feature, mode, section, hash: feature.route + (canonical.size ? `?${canonical}` : '') };
}

export function routeForVersion(kind: LibraryKind) {
  return resolveRoute(kind === 'icon' ? 'icons' : kind).hash;
}

export function isEditorRoute(hash: string, id: string, ...modes: string[]) {
  const route = resolveRoute(hash);
  return route.feature.id === id && (!modes.length || modes.includes(route.mode ?? ''));
}
