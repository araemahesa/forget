import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiPage } from './GuiPage';
import { buildGuiScene } from './guiScene';

const viewport = vi.hoisted(() => ({ objects: [] as unknown[] }));
vi.mock('./guiScene', () => ({ buildGuiScene: vi.fn(() => ({})) }));
vi.mock('../create/geometry', () => ({ disposeGeometry: vi.fn() }));
vi.mock('../create/ThreeViewport', () => ({ ThreeViewport: ({ object }: { object: unknown }) => { viewport.objects.push(object); return null; } }));
vi.mock('../create/CreativeControls', () => ({ CreativeControls: () => null }));
vi.mock('../create/StudioApply', () => ({ StudioApply: () => null }));
vi.mock('../create/useCreativeTask', () => ({ useCreativeTask: () => ({ version: null, busy: false, run: vi.fn() }) }));

beforeEach(() => { vi.useFakeTimers(); vi.mocked(buildGuiScene).mockClear(); viewport.objects = []; });
afterEach(() => vi.useRealTimers());

it('rebuilds the 3D scene once after typing settles instead of on every keystroke', async () => {
  render(<GuiPage />);
  expect(buildGuiScene).toHaveBeenCalledTimes(1);
  const input = screen.getByLabelText('Nama ScreenGui');
  for (const value of ['S', 'Sh', 'Sho', 'Shop']) fireEvent.change(input, { target: { value } });
  expect(input).toHaveValue('Shop');
  expect(buildGuiScene).toHaveBeenCalledTimes(1);
  expect(new Set(viewport.objects).size).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(buildGuiScene).toHaveBeenCalledTimes(2);
  expect(vi.mocked(buildGuiScene).mock.lastCall?.[0]).toMatchObject({ screenName: 'Shop' });
});
