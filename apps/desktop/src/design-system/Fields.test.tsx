import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';
import { TextField } from './TextField';

describe('field associations across mounted creators', () => {
  it('focuses the visible repeated label and keeps error descriptions local', async () => {
    const field = (value: string) => <TextField label="Seed pengacakan" value={value}
      onChange={() => {}} error="Seed tidak valid" />;
    render(<><section hidden>{field('1')}</section><section>{field('2')}</section></>);
    const inputs = screen.getAllByLabelText('Seed pengacakan', { exact: true });
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[1]).toHaveAccessibleName('Seed pengacakan');
    expect(inputs[1]).toHaveAccessibleDescription('Seed tidak valid');
    await userEvent.click(screen.getAllByText('Seed pengacakan')[1]);
    expect(inputs[1]).toHaveFocus();
    expect(document.querySelectorAll('[id]').length).toBe(new Set(
      [...document.querySelectorAll('[id]')].map((node) => node.id),
    ).size);
  });

  it('associates each repeated select label with its own control', async () => {
    const field = () => <Select label="Preset" value="manual" onChange={() => {}}
      options={[{ value: 'manual', label: 'Manual' }]} />;
    render(<><section hidden>{field()}</section><section>{field()}</section></>);
    const selects = screen.getAllByLabelText('Preset', { exact: true });
    expect(selects[0].id).not.toBe(selects[1].id);
    await userEvent.click(screen.getAllByText('Preset')[1]);
    expect(selects[1]).toHaveFocus();
  });
});
