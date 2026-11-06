import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { eulerXYZToQuat, type ObjectAnimationDocument } from '@forgekit/contracts';

const mocks = vi.hoisted(() => ({ task: null as Record<string, unknown> | null, extras: [] as unknown[] }));
vi.mock('../create/useCreativeTask', () => ({ useCreativeTask: () => mocks.task }));
vi.mock('../create/CreativeControls', () => ({
  CreativeControls: ({ promptLabel, children }: { promptLabel: string; children: React.ReactNode }) => <div><label>{promptLabel}<textarea /></label>{children}</div>,
}));
vi.mock('../create/ThreeViewport', () => ({ ThreeViewport: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }));
vi.mock('../create/StudioApply', () => ({ StudioApply: () => null }));

import { AnimationPage } from './AnimationPage';

const door: ObjectAnimationDocument = {
  schemaVersion: 2, name: 'Pintu berat', targetEngine: 'roblox', units: 'stud', coordinateSystem: 'y-up-right-handed',
  rotationConvention: 'quaternion-xyzw-local', timeUnit: 'seconds', qualityProfile: 'high_polish', animationMode: 'object',
  object: { parts: [
    { id: 'frame', name: 'Kusen', parentId: null, shape: 'block', size: [0.5, 8, 0.5], color: '#553311', pivot: [0, 4, 0], offset: [0, 0, 0], restRotation: [0, 0, 0, 1] },
    { id: 'panel', name: 'Daun', parentId: 'frame', shape: 'block', size: [4, 7, 0.3], color: '#885522', pivot: [0.25, -0.5, 0], offset: [2, 0, 0], restRotation: [0, 0, 0, 1] },
  ] },
  motionIntent: {
    originalPrompt: 'Buka pintu 100 derajat, kusen tetap diam.',
    assumptions: ['Pintu membuka ke dalam.'],
    requirements: [
      { id: 'open', kind: 'action', text: 'Daun pintu membuka 100°', excerpt: 'Buka pintu 100 derajat', binding: { clipId: 'open', targetIds: ['panel'], window: [0, 1.2] } },
      { id: 'still', kind: 'prohibition', text: 'Kusen diam', excerpt: 'kusen tetap diam', binding: { clipId: 'open', targetIds: ['frame'], window: [0, 1.2] } },
    ],
  },
  clips: [{ id: 'open', name: 'Buka', durationSeconds: 1.2, loopMode: 'once', markers: [{ id: 'opened', timeSeconds: 1.2, eventType: 'door_open' }], tracks: [
    { targetId: 'panel', property: 'rotation', interpolation: 'smooth', keys: [{ timeSeconds: 0, value: [0, 0, 0, 1] }, { timeSeconds: 1.2, value: eulerXYZToQuat([0, 100, 0]) }] },
  ] }],
};

function task(recipe: unknown) {
  return {
    busy: false, version: recipe ? { id: 'v1', taskId: 't', document: { kind: 'animation', recipe } } : null,
    setRequestExtras: (value: unknown) => mocks.extras.push(value), setError: vi.fn(), setNotice: vi.fn(), run: vi.fn(),
  };
}
beforeEach(() => { mocks.extras = []; localStorage.clear(); });

it('offers both modes with a prompt-first input and sends the chosen mode with generation', async () => {
  mocks.task = task(null);
  render(<AnimationPage />);
  expect(screen.getByText('Jelaskan animasi yang ingin kamu buat')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Animasi Karakter/ })).toHaveAttribute('aria-selected', 'true');
  expect(mocks.extras.at(-1)).toEqual({ animation: { mode: 'character', qualityProfile: 'high_polish' } });
  await userEvent.click(screen.getByRole('tab', { name: /Animasi Objek 3D/ }));
  expect(mocks.extras.at(-1)).toEqual({ animation: { mode: 'object', qualityProfile: 'high_polish' } });
  expect(screen.getByText(/bukan klip contoh/)).toBeInTheDocument();
});

it('plays the saved document and reports prompt adherence from measured motion', () => {
  mocks.task = task(door);
  render(<AnimationPage />);
  expect(screen.getByRole('img', { name: 'Viewport animasi objek' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Animasi Objek 3D/ })).toHaveAttribute('aria-selected', 'true');
  const adherence = screen.getByRole('region', { name: 'Kepatuhan prompt' });
  expect(within(adherence).getByText('Daun pintu membuka 100°').closest('li')).toHaveTextContent('Gerak terdeteksi');
  expect(within(adherence).getByText('Kusen diam').closest('li')).toHaveTextContent('Terpenuhi');
  expect(screen.getByText('Terverifikasi teknis')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'door_open' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Tahapan bukti' })).toHaveTextContent('○ Diuji di runtime Roblox');
});

it('still opens legacy v1 recipes through the migration', () => {
  mocks.task = task({ name: 'Idle lama', rigType: 'R6', duration: 2, loop: true, priority: 'Idle', keyframes: [
    { time: 0, jointRotations: { Torso: [0, 0, 0] } }, { time: 1, jointRotations: { Torso: [3, 0, 0] } }, { time: 2, jointRotations: { Torso: [0, 0, 0] } },
  ] });
  render(<AnimationPage />);
  expect(screen.getByText(/dimigrasikan dari v1/)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Viewport animasi karakter' })).toBeInTheDocument();
});
