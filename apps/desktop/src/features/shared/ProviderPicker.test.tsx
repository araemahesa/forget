import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { AiProviderProfile } from '@forgekit/contracts';
import { ProviderPicker } from './ProviderPicker';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../services/tauri', () => ({ call: invoke }));
const profiles: AiProviderProfile[] = ['a', 'b', 'c'].map((id, i) => ({ id: `picker-${id}`, name: `Akun ${id.toUpperCase()}`, providerType: i === 2 ? 'anthropic' : 'openai', model: 'test', baseUrl: 'https://api.openai.com/v1', keyReference: `key-${id}`, isDefault: i === 0, createdAt: '1', updatedAt: '1' }));
function Fixture() {
  const [value, setValue] = useState(profiles[0].id);
  return <ProviderPicker profiles={profiles} value={value} onChange={setValue} label="Provider uji" />;
}
it('opens provider logos before accounts and never reads quota in the picker', async () => {
  render(<Fixture />);
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox', { name: 'Provider uji' });
  expect(trigger.textContent).toBe('');
  expect(trigger).toHaveAccessibleDescription('OpenAI · Akun A');
  await user.click(trigger);
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByText('Akun A')).toBeNull();
  await user.click(screen.getByRole('option', { name: 'OpenAI' }));
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByText('Utama')).toBeNull();
  expect(screen.queryByText('Sisa penggunaan')).toBeNull();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(trigger).toHaveAttribute('value', 'picker-b');
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  await user.click(trigger);
  expect(screen.getByRole('option', { name: 'Claude' })).toBeVisible();
  await user.click(screen.getByRole('option', { name: 'Claude' }));
  await user.click(screen.getByRole('button', { name: 'Semua provider' }));
  await user.keyboard('{ArrowDown}{Enter}{Enter}');
  expect(trigger).toHaveAttribute('value', 'picker-c');
  expect(trigger.querySelector('img')).toHaveAttribute('src', '/branding/providers/claude.svg');
});
it('does not offer a fake provider without connected accounts', () => {
  render(<ProviderPicker profiles={[]} value="" onChange={() => {}} label="Akun kosong" />);
  expect(screen.getByRole('combobox', { name: 'Akun kosong' })).toBeDisabled();
});
it('resolves inherited selection without a duplicate automatic option', async () => {
  const change = vi.fn();
  render(<ProviderPicker profiles={profiles} value="inherit" onChange={change} label="Akun nyata" />);
  const trigger = screen.getByRole('combobox', { name: 'Akun nyata' });
  expect(trigger).toHaveAccessibleDescription('OpenAI · Akun A');
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('option', { name: 'OpenAI' }));
  expect(screen.queryByText(/Ikuti pilihan|Pilihan Utama Aplikasi|Otomatis/)).toBeNull();
  await userEvent.click(screen.getByRole('option', { name: /Akun B/ }));
  expect(change).toHaveBeenCalledWith('picker-b');
});

it('switches accounts through the provider logo without a next-account button', async () => {
  render(<Fixture />);
  const user = userEvent.setup();
  expect(screen.queryByRole('button', { name: 'Akun berikutnya' })).not.toBeInTheDocument();
  const trigger = screen.getByRole('combobox', { name: 'Provider uji' });
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: 'OpenAI' }));
  await user.click(screen.getByRole('option', { name: /Akun B/ }));
  expect(trigger).toHaveAttribute('value', 'picker-b');
  expect(trigger).toHaveAccessibleDescription('OpenAI · Akun B');
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
