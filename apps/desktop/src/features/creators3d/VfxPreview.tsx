import { useEffect, useId, useRef, useState } from 'react';
import type { VfxRecipe } from '@forgekit/contracts';

export function particleOpacity(recipe: VfxRecipe, age: number) {
  const points = recipe.transparency ?? [{ time: 0, value: 0 }, { time: 1, value: 1 }];
  const next = points.findIndex(p => p.time >= age);
  if (next <= 0) return 1 - points[next < 0 ? points.length - 1 : 0].value;
  const a = points[next - 1], b = points[next];
  return 1 - (a.value + (b.value - a.value) * (age - a.time) / (b.time - a.time));
}

export function VfxPreview({ recipe, playing }: { recipe: VfxRecipe; playing: boolean }) {
  const gradient = useId();
  const elapsed = useRef(0);
  const canvas = useRef<SVGSVGElement>(null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame: number, last: number | undefined, painted = 0;
    function tick(time: number) {
      frame = requestAnimationFrame(tick);
      if (document.hidden || canvas.current?.closest('[hidden]')) { last = undefined; return; }
      if (last !== undefined) elapsed.current += Math.min((time - last) / 1000, 0.05);
      last = time;
      if (time - painted >= 50) { painted = time; setSeconds(elapsed.current); }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  // Preview is bounded to 96 particles; recipe rate and export remain unchanged.
  const count = Math.min(96, Math.ceil(recipe.rate * recipe.lifetime[1]));
  return <svg ref={canvas} viewBox="0 0 400 260" className="mesh-preview-svg" role="img" aria-label={`Simulasi parameter ${recipe.name}`} style={{ width: '100%', maxHeight: 320 }}>
    <defs><radialGradient id={gradient}><stop offset="0%" stopColor={recipe.startColor} /><stop offset="100%" stopColor={recipe.endColor} stopOpacity="0" /></radialGradient></defs>
    <circle cx="200" cy="210" r="4" fill="var(--text-muted)" />
    {Array.from({ length: count }, (_, i) => {
      const fraction = ((i * 0.618034) % 1);
      const lifetime = recipe.lifetime[0] + fraction * (recipe.lifetime[1] - recipe.lifetime[0]);
      const age = ((seconds + i / recipe.rate) % lifetime) / lifetime;
      const angle = (fraction - 0.5) * recipe.spread * Math.PI / 180;
      const distance = age * lifetime * (recipe.speed[0] + fraction * (recipe.speed[1] - recipe.speed[0])) * 6;
      const x = 200 + Math.sin(angle) * distance, y = 210 - Math.cos(angle) * distance;
      const size = Math.max(0.5, (recipe.sizeStart + (recipe.sizeEnd - recipe.sizeStart) * age) * 5);
      return recipe.type === 'beam' || recipe.type === 'trail'
        ? <line key={i} x1={x} y1={y} x2={x - Math.sin(angle) * size * 4} y2={y + Math.cos(angle) * size * 4} stroke={age < 0.5 ? recipe.startColor : recipe.endColor} strokeWidth={Math.max(0.5, size / 3)} opacity={particleOpacity(recipe, age)} />
        : <circle key={i} cx={x} cy={y} r={size} fill={`url(#${gradient})`} opacity={particleOpacity(recipe, age)} />;
    })}
    <text x="200" y="250" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">Preview parameter · maksimum 96 partikel · bukan runtime Roblox</text>
  </svg>;
}
