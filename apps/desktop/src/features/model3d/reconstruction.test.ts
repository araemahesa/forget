import { expect, it } from 'vitest';
import { model3dRequiresMesh, validateModel3dRecipe, type Model3dRecipe } from '@forgekit/contracts';
import cases from '../../../../../packages/contracts/src/model3d-reconstruction-cases.json';
import { buildModel } from '../create/geometry';

const recipe = (reconstruction: unknown) => ({name:'Reference reconstruction', category:'prop', seed:0, exportFormat:'blend', parts:[{
  id:'body',name:'Body',primitive:'reconstruction',position:[0,0,0],size:[3,3,2],rotation:[0,0,0],color:'#666666',material:'Plastic',reconstruction,
}]});
it.each(cases)('validates reconstruction data: $name', item => {
  const value = recipe(item.reconstruction);
  expect(validateModel3dRecipe(value).length === 0).toBe(item.valid);
  if (item.valid) {
    expect(model3dRequiresMesh(value as Model3dRecipe)).toBe(true);
    expect(() => buildModel(value as Model3dRecipe)).toThrow(/Blender/);
  }
});
it('bounds reconstructed components independently of the ordinary part budget', () => {
  const value = recipe(cases[0].reconstruction);
  value.parts = Array.from({length:5}, (_, i) => ({...value.parts[0], id:`p${i}`}));
  expect(validateModel3dRecipe(value).length).toBeGreaterThan(0);
});
