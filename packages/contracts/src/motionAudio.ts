export type MusicTrack = { id: string; name: string; instrument: 'synth' | 'bass' | 'lead' | 'pad' | 'percussion'; volume: number; notes: { pitch: string; duration: number; time: number }[] };
export type MusicRecipe = { title: string; bpm: number; timeSignature: '4/4' | '3/4' | '6/8'; key: string; scale: 'major' | 'minor' | 'dorian'; durationSeconds: number; tracks: MusicTrack[] };
export type CameraKeyframe = { time: number; position: [number, number, number]; lookAt: [number, number, number]; fov: number; easing: 'Linear' | 'Sine' | 'Quad' | 'Cubic' | 'Quint' };
export type CutsceneRecipe = { title: string; duration: number; loop: boolean; keyframes: CameraKeyframe[] };
export type AnimationRecipe = { name: string; rigType: 'R6' | 'R15'; duration: number; loop: boolean; priority: 'Core' | 'Idle' | 'Movement' | 'Action'; keyframes: { time: number; jointRotations: Record<string, [number, number, number]> }[] };
export { validateMusicRecipe, validateCutsceneRecipe, validateAnimationRecipe } from './skybox-runtime.js';
