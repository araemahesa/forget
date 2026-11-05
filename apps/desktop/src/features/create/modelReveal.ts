import { Group, Material, Mesh } from 'three';

// Presentation of actual Blender triangles only; the animation never changes the saved geometry.
export function modelReveal(object: Group, reducedMotion: boolean) {
  const meshes: { mesh: Mesh; start: number; count: number; total: number }[] = [];
  const materials = new Map<Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  object.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const { start, count } = node.geometry.drawRange;
    const total = Math.min(count, (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) - start);
    meshes.push({ mesh: node, start, count, total });
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!materials.has(material)) materials.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    }
  });
  let elapsed = 0, finished = reducedMotion;
  function restore() {
    for (const { mesh, start, count } of meshes) mesh.geometry.setDrawRange(start, count);
    for (const [material, original] of materials) { Object.assign(material, original); material.needsUpdate = true; }
    finished = true;
  }
  function update(seconds: number) {
    if (finished) return;
    elapsed += Math.max(0, seconds);
    const progress = Math.min(elapsed / 1.6, 1), eased = 1 - (1 - progress) ** 3;
    for (const { mesh, start, total } of meshes) mesh.geometry.setDrawRange(start, Math.floor(total * eased / 3) * 3);
    for (const [material, original] of materials) material.opacity = original.opacity * Math.min(1, progress * 3);
    if (progress >= 1) restore();
  }
  if (!reducedMotion) {
    for (const [material] of materials) { material.transparent = true; material.depthWrite = false; material.needsUpdate = true; }
    update(0);
  }
  return { update, restore };
}
