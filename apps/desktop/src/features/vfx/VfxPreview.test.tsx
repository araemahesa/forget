import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { VfxRecipe } from '@forgekit/contracts';
import { particleOpacity, VfxPreview } from './VfxPreview';
const recipe: VfxRecipe = { name: 'Wind', type: 'particles', rate: 12, lifetime: [1, 2], speed: [2, 4], spread: 15, startColor: '#ffffff', endColor: '#cccccc', sizeStart: 1, sizeEnd: 0, lightEmission: 0, transparency: [{ time: 0, value: 1 }, { time: 0.5, value: 0 }, { time: 1, value: 1 }] };
it('interpolates actual fade and bounds preview density without changing the recipe', () => {
  expect(particleOpacity(recipe, 0)).toBe(0);
  expect(particleOpacity(recipe, 0.25)).toBe(0.5);
  expect(particleOpacity(recipe, 0.5)).toBe(1);
  expect(particleOpacity(recipe, 1)).toBe(0);
  const { container } = render(<VfxPreview recipe={{ ...recipe, rate: 500 }} playing={false} />);
  expect(screen.getByRole('img', { name: 'Simulasi parameter Wind' })).toBeVisible();
  expect(container.querySelectorAll('circle')).toHaveLength(97);
  expect(recipe.rate).toBe(12);
});
