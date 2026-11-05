export type SkyboxPreset = 'clear_day' | 'sunset' | 'night_stars' | 'overcast' | 'blood_moon' | 'alien_nebula';
export type CubeFace = 'ft' | 'bk' | 'lf' | 'rt' | 'up' | 'dn';
export type SkyboxRecipe = { schemaVersion: 1; name: string; preset: SkyboxPreset; timeOfDay: number; sunElevation: number; sunAzimuth: number; topColor: string; horizonColor: string; bottomColor: string; sunColor: string; starDensity: number; cloudCover: number; haze: number; resolution: 512 | 1024; seed: number };
export { skyboxPresetsData, cubeFaces, cubeFaceLabels, validateSkyboxRecipe, hasBlockingSkyboxErrors } from './skybox-runtime.js';
