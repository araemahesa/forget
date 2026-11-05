import type { ValidationIssue } from './gfx';
import { boundedNumber, boundedText, exactKeys, object, triple } from './creative';
import materialPresets from './model3d-materials.json';
import { validModel3dProfileRings } from './model3d-profile';

// F03 — 3D Model Generator
export type Model3dPrimitive = 'cube' | 'sphere' | 'cylinder' | 'wedge' | 'cone' | 'torus' | 'profile' | 'mesh' | 'lathe' | 'reconstruction';
export const MODEL3D_MAX_PARTS = 128;
export const MODEL3D_MAX_TRIANGLES = 200000;

export type Model3dPart = {
  id: string;
  name: string;
  primitive: Model3dPrimitive;
  position: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  color: string;
  material: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissiveIntensity?: number;
  /** Rounded cube edge radius in studs, at most one quarter of its shortest side. */
  bevel?: number;
  /** Radial resolution for sphere/cylinder/cone/torus. */
  segments?: number;
  smooth?: boolean;
  subdivision?: number;
  profile?: { outline: [number, number][]; holes: [number, number][][]; bevel: number };
  mesh?: { vertices: [number, number, number][]; faces: number[][] };
  lathe?: { points: [number, number][] };
  reconstruction?: {
    resolution: 64 | 96 | 128;
    views: { image: number; view: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'; crop: [number, number, number, number]; background: string; tolerance: number }[];
  };
};

export function model3dSurface(part: Model3dPart) {
  const base = materialPresets[part.material as keyof typeof materialPresets];
  return {
    roughness: part.roughness ?? base.roughness,
    metalness: part.metalness ?? base.metalness,
    opacity: part.opacity ?? base.opacity,
    emissiveIntensity: part.emissiveIntensity ?? base.emissiveIntensity,
  };
}

export function model3dRequiresMesh(recipe: Model3dRecipe) {
  return recipe.parts.some(part => ['profile', 'mesh', 'lathe', 'reconstruction'].includes(part.primitive) ||
    ['roughness', 'metalness', 'opacity', 'emissiveIntensity', 'bevel', 'segments', 'smooth', 'subdivision'].some(key => Object.hasOwn(part, key)));
}

export type Model3dRecipe = {
  name: string;
  category: 'prop' | 'accessory' | 'building' | 'creature';
  seed: number;
  parts: Model3dPart[];
  exportFormat: 'blend' | 'glb' | 'obj' | 'rbxmx';
};

export function validateModel3dRecipe(recipe: unknown): ValidationIssue[] {
  const error = (path: string, message: string): ValidationIssue[] => [{ severity: 'error', path, message }];
  if (!object(recipe) || !exactKeys(recipe, ['name', 'category', 'seed', 'parts', 'exportFormat'])) return error('recipe', 'Struktur model tidak sah.');
  if (!boundedText(recipe.name)) return error('name', 'Nama model harus berisi 1-120 karakter tanpa karakter kontrol.');
  if (!['prop', 'accessory', 'building', 'creature'].includes(String(recipe.category)) || !['blend', 'glb', 'obj', 'rbxmx'].includes(String(recipe.exportFormat)) || !Number.isSafeInteger(recipe.seed)) return error('recipe', 'Kategori, seed, atau format model tidak sah.');
  if (!Array.isArray(recipe.parts) || !recipe.parts.length || recipe.parts.length > MODEL3D_MAX_PARTS) return error('parts', 'Model memerlukan 1-128 komponen.');
  const ids = new Set<string>();
  let profilePoints = 0;
  for (const [index, part] of recipe.parts.entries()) {
    const optional = ['roughness', 'metalness', 'opacity', 'emissiveIntensity', 'bevel', 'segments', 'smooth', 'subdivision'];
    if (!object(part) || !exactKeys(part, ['id', 'name', 'primitive', 'position', 'size', 'rotation', 'color', 'material', ...(['profile', 'mesh', 'lathe', 'reconstruction'].includes(String(part.primitive)) ? [String(part.primitive)] : []), ...optional.filter(key => Object.hasOwn(part, key))]) ||
      !boundedText(part.id, 64) || ids.has(part.id) || !boundedText(part.name) ||
      !['cube', 'sphere', 'cylinder', 'wedge', 'cone', 'torus', 'profile', 'mesh', 'lathe', 'reconstruction'].includes(String(part.primitive)) ||
      !triple(part.position, -10000, 10000) || !triple(part.size, 0.001, 1000) || !triple(part.rotation, -360, 360) ||
      typeof part.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(part.color) ||
      !['Plastic', 'Wood', 'Metal', 'Glass', 'Concrete', 'Neon'].includes(String(part.material))) return error(`parts.${index}`, 'Komponen tidak sah: identitas unik, transform terbatas, warna #RRGGBB, dan material yang didukung diperlukan.');
    ids.add(part.id);
    for (const key of ['roughness', 'metalness', 'opacity', 'emissiveIntensity']) {
      if (Object.hasOwn(part, key) && !boundedNumber(part[key], 0, key === 'emissiveIntensity' ? 5 : 1)) return error(`parts.${index}.${key}`, `${key} berada di luar batas permukaan.`);
    }
    if (Object.hasOwn(part, 'bevel') && (part.primitive !== 'cube' || !boundedNumber(part.bevel, 0, Math.min(...part.size as number[]) / 4))) return error(`parts.${index}.bevel`, 'Bevel kubus maksimal seperempat sisi terkecil, dalam stud.');
    if (Object.hasOwn(part, 'segments') && (!['sphere', 'cylinder', 'cone', 'torus', 'lathe'].includes(String(part.primitive)) || !Number.isInteger(part.segments) || !boundedNumber(part.segments, 8, 64))) return error(`parts.${index}.segments`, 'Resolusi radial harus bilangan bulat 8-64 untuk bentuk melengkung.');
    if (Object.hasOwn(part, 'subdivision') && (part.primitive !== 'mesh' || !Number.isInteger(part.subdivision) || !boundedNumber(part.subdivision, 0, 2))) return error(`parts.${index}.subdivision`, 'Subdivision mesh harus integer 0-2.');
    if (Object.hasOwn(part, 'smooth') && typeof part.smooth !== 'boolean') return error(`parts.${index}.smooth`, 'Smooth harus boolean.');
    if (part.primitive === 'reconstruction') {
      const spec = part.reconstruction;
      if (!object(spec) || !exactKeys(spec, ['resolution', 'views']) || ![64, 96, 128].includes(Number(spec.resolution)) || typeof spec.resolution !== 'number' || !Array.isArray(spec.views) || spec.views.length < 2 || spec.views.length > 6) return error(`parts.${index}.reconstruction`, 'Rekonstruksi memerlukan 2-6 sudut ortografis dan resolution 64, 96, atau 128.');
      const seen = new Set<string>(), axes = new Set<string>();
      for (const view of spec.views) {
        if (!object(view) || !exactKeys(view, ['image', 'view', 'crop', 'background', 'tolerance']) || !Number.isInteger(view.image) || !boundedNumber(view.image, 0, 11) || !['front', 'back', 'right', 'left', 'top', 'bottom'].includes(String(view.view)) || seen.has(String(view.view)) || !Array.isArray(view.crop) || view.crop.length !== 4 || !view.crop.every(n => boundedNumber(n, 0, 1)) || view.crop[2] < .02 || view.crop[3] < .02 || view.crop[0]+view.crop[2] > 1+1e-9 || view.crop[1]+view.crop[3] > 1+1e-9 || typeof view.background !== 'string' || !(view.background === 'alpha' || /^#[0-9a-f]{6}$/i.test(view.background)) || !boundedNumber(view.tolerance, .01, .4)) return error(`parts.${index}.reconstruction.views`, 'Sudut/crop/background rekonstruksi tidak sah.');
        seen.add(String(view.view)); axes.add(['front', 'back'].includes(String(view.view)) ? 'z' : ['left', 'right'].includes(String(view.view)) ? 'x' : 'y');
      }
      if (axes.size < 2) return error(`parts.${index}.reconstruction.views`, 'Gunakan minimal dua sumbu kamera berbeda, misalnya front dan right.');
      if (recipe.parts.filter(p => object(p) && p.primitive === 'reconstruction').length > 4) return error('parts', 'Maksimal empat komponen rekonstruksi per model.');
    }
    if (part.primitive === 'mesh') {
      const m = part.mesh;
      if (!object(m) || !exactKeys(m, ['vertices', 'faces']) || !Array.isArray(m.vertices) || m.vertices.length < 4 || m.vertices.length > 2048 || !m.vertices.every(v => triple(v, -1, 1)) || !Array.isArray(m.faces) || !m.faces.length || m.faces.length > 4096) return error(`parts.${index}.mesh`, 'Mesh memerlukan 4-2048 vertex dalam -1..1 dan 1-4096 face triangle/quad.');
      const vertices = m.vertices as number[][];
      const used = new Set<number>(), faces = new Set<string>();
      if ([0, 1, 2].some(axis => Math.max(...vertices.map(v => v[axis])) - Math.min(...vertices.map(v => v[axis])) < 1e-6)) return error(`parts.${index}.mesh`, 'Mesh harus memiliki volume pada ketiga sumbu.');
      for (const face of m.faces) {
        if (!Array.isArray(face) || ![3, 4].includes(face.length) || new Set(face).size !== face.length || !face.every(i => Number.isInteger(i) && i >= 0 && i < vertices.length)) return error(`parts.${index}.mesh`, 'Indeks face mesh tidak sah.');
        const key = [...face].sort((a,b) => a-b).join(',');
        if (faces.has(key)) return error(`parts.${index}.mesh`, 'Face mesh berulang.');
        faces.add(key); face.forEach(i => used.add(i));
        for (const tri of face.length === 3 ? [face] : [[face[0],face[1],face[2]],[face[0],face[2],face[3]]]) {
          const [a, b, c] = tri.map(i => vertices[i]);
          const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
          if (Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]) < 1e-9) return error(`parts.${index}.mesh`, 'Face mesh degenerat.');
        }
      }
      if (used.size !== vertices.length) return error(`parts.${index}.mesh`, 'Mesh memuat vertex tanpa face.');
    }
    if (part.primitive === 'lathe') {
      const l = part.lathe;
      if (!object(l) || !exactKeys(l, ['points']) || !Array.isArray(l.points) || l.points.length < 3 || l.points.length > 128 || !l.points.every(p => Array.isArray(p) && p.length === 2 && boundedNumber(p[0], 0, 1) && boundedNumber(p[1], -1, 1))) return error(`parts.${index}.lathe`, 'Lathe memerlukan 3-128 pasangan radius/tinggi dalam 0..1 dan -1..1.');
      const points = l.points as number[][];
      if (Math.max(...points.map(p => p[0])) < 1e-6 || Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) < 1e-6 || points.some((p, i) => i > 0 && Math.hypot(p[0]-points[i-1][0], p[1]-points[i-1][1]) < 1e-9)) return error(`parts.${index}.lathe`, 'Profil lathe degenerat.');
    }
    if (part.primitive === 'profile') {
      const p = part.profile;
      const ring = (v: unknown) => Array.isArray(v) && v.length >= 3 && v.length <= 128 && v.every(point => Array.isArray(point) && point.length === 2 && point.every(n => boundedNumber(n, -1, 1))) && Math.abs(v.reduce((area, point, i) => { const next = v[(i + 1) % v.length]; return area + point[0] * next[1] - next[0] * point[1]; }, 0)) > 1e-6;
      if (!object(p) || !exactKeys(p, ['outline', 'holes', 'bevel']) || !ring(p.outline) || !Array.isArray(p.holes) || p.holes.length > 8 || !p.holes.every(ring) || !boundedNumber(p.bevel, 0, .05)) return error(`parts.${index}.profile`, 'Kontur harus 3–128 titik XY dalam -1..1, maksimal 8 rongga, dan bevel 0–0,05.');
      profilePoints += ([p.outline, ...p.holes] as [number, number][][]).reduce((n, ring) => n + ring.length, 0);
      if (profilePoints > 8192) return error('parts', 'Total titik kontur model maksimal 8192.');
      if (!validModel3dProfileRings([p.outline, ...p.holes] as [number, number][][])) return error(`parts.${index}.profile`, 'Kontur bersilangan, titik berulang, atau rongga keluar/bertumpuk/menyentuh batas.');
    }
  }
  return [];
}

// F04 — 3D Texture Editor
export type Texture3dLayer = {
  id: string;
  name: string;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
  opacity: number;
  color: string;
  roughness: number;
  metalness: number;
  visible: boolean;
};

export type Texture3dRecipe = {
  modelName: string;
  resolution: 512 | 1024 | 2048;
  layers: Texture3dLayer[];
  generateNormalMap: boolean;
};

export function validateTexture3dRecipe(recipe: Texture3dRecipe): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!recipe.modelName || recipe.modelName.trim().length === 0) {
    issues.push({ severity: 'error', message: 'Nama model target tidak boleh kosong.', path: 'modelName' });
  }
  if (!recipe.layers || recipe.layers.length === 0) {
    issues.push({ severity: 'error', message: 'Harus ada setidaknya satu layer material.', path: 'layers' });
  }
  return issues;
}

// F06 — VFX Generator
export type VfxEmitterType = 'particles' | 'beam' | 'trail' | 'burst';

export type VfxRecipe = {
  name: string;
  type: VfxEmitterType;
  rate: number;
  lifetime: [number, number];
  speed: [number, number];
  spread: number;
  startColor: string;
  endColor: string;
  sizeStart: number;
  sizeEnd: number;
  lightEmission: number;
  transparency?: { time: number; value: number }[];
};

export function validateVfxRecipe(recipe: VfxRecipe): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!recipe.name || recipe.name.trim().length === 0) {
    issues.push({ severity: 'error', message: 'Nama efek VFX tidak boleh kosong.', path: 'name' });
  }
  if (recipe.rate < 1 || recipe.rate > 500) {
    issues.push({ severity: 'error', message: 'Laju partikel harus antara 1 dan 500.', path: 'rate' });
  }
  if (recipe.transparency !== undefined && (!Array.isArray(recipe.transparency) || recipe.transparency.length < 2 || recipe.transparency.length > 16 || recipe.transparency[0]?.time !== 0 || recipe.transparency.at(-1)?.time !== 1 || recipe.transparency.some((p, i, points) => !p || !Number.isFinite(p.time) || !Number.isFinite(p.value) || p.value < 0 || p.value > 1 || p.time < 0 || p.time > 1 || (i > 0 && p.time <= points[i - 1].time)))) {
    issues.push({ severity: 'error', message: 'Fade harus berurutan dari waktu 0 ke 1, dengan transparansi 0–1.', path: 'transparency' });
  }
  return issues;
}

// F15 — Dialogue Tree & NPC
export type DialogueNode = {
  id: string;
  speaker: string;
  text: string;
  choices: { text: string; nextNodeId?: string }[];
};

export type NpcDialogueRecipe = {
  npcName: string;
  initialNodeId: string;
  nodes: DialogueNode[];
};

export function validateNpcDialogueRecipe(recipe: NpcDialogueRecipe): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!recipe.npcName || recipe.npcName.trim().length === 0) {
    issues.push({ severity: 'error', message: 'Nama NPC tidak boleh kosong.', path: 'npcName' });
  }
  if (!recipe.nodes || recipe.nodes.length === 0) {
    issues.push({ severity: 'error', message: 'Graf dialog harus memiliki setidaknya satu node.', path: 'nodes' });
  }
  return issues;
}

// F17 — GUI Designer
export type GuiElement = {
  id: string;
  parentId?: string;
  anchorPoint?: [number, number];
  type: 'Frame' | 'TextLabel' | 'TextButton' | 'ImageLabel';
  name: string;
  size: [number, number, number, number];
  position: [number, number, number, number];
  backgroundColor: string;
  text?: string;
  textColor?: string;
  cornerRadius?: number;
};

export type GuiRecipe = {
  screenName: string;
  targetDevice: 'desktop' | 'mobile' | 'tablet' | 'console';
  elements: GuiElement[];
};

export function validateGuiRecipe(recipe: GuiRecipe): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!recipe.screenName || recipe.screenName.trim().length === 0) {
    issues.push({ severity: 'error', message: 'Nama GUI tidak boleh kosong.', path: 'screenName' });
  }
  if (!recipe.elements || recipe.elements.length === 0) {
    issues.push({ severity: 'error', message: 'Antarmuka harus memiliki setidaknya satu elemen.', path: 'elements' });
  }
  const elements = recipe.elements ?? [];
  const byId = new Map(elements.map(el => [el.id, el]));
  if (byId.size !== elements.length) issues.push({ severity: 'error', message: 'ID elemen GUI harus unik.', path: 'elements' });
  for (const el of elements) {
    const seen = new Set([el.id]);
    let parent = el.parentId;
    while (parent) {
      if (seen.has(parent) || !byId.has(parent)) { issues.push({ severity: 'error', message: 'Parent GUI hilang atau membentuk siklus.', path: 'elements' }); break; }
      seen.add(parent); parent = byId.get(parent)?.parentId;
    }
    if (el.anchorPoint && (el.anchorPoint.length !== 2 || el.anchorPoint.some(n => !Number.isFinite(n) || n < 0 || n > 1))) issues.push({ severity: 'error', message: 'AnchorPoint harus dua angka 0–1.', path: 'elements' });
    if (!Array.isArray(el.size) || !Array.isArray(el.position) || el.size.length !== 4 || el.position.length !== 4 || [...el.size, ...el.position].some(n => !Number.isFinite(n)) || el.size[0] < 0 || el.size[1] < 0 || el.size[2] < 0 || el.size[3] < 0) issues.push({ severity: 'error', message: 'Size dan Position UDim2 harus valid.', path: 'elements' });
  }
  return issues;
}
