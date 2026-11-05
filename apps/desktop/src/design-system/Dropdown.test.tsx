import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';
function Fixture() {
  const [value, setValue] = useState('a');
  return <><label>Provider<Dropdown value={value} onChange={(event) => setValue(event.target.value)}>
    <option value="a">OpenAI</option><option value="disabled" disabled>Tidak tersedia</option><option value="c">Claude</option>
  </Dropdown></label><button type="button">Di luar</button><output>{value}</output></>;
}
describe('Dropdown', () => {
  it('keeps the field label, selects by keyboard, skips disabled items and restores trigger focus', async () => {
    render(<Fixture />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('combobox', { name: 'Provider' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('c');
    expect(trigger).toHaveTextContent('Claude');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('supports pointer selection, Escape, outside dismissal and typeahead without changing until committed', async () => {
    render(<Fixture />);
    const user = userEvent.setup();
    const trigger = screen.getByLabelText('Provider');
    await user.click(trigger);
    fireEvent.scroll(document);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('option', { name: 'Claude' }));
    expect(trigger).toHaveTextContent('Claude');
    await user.click(trigger);
    await user.keyboard('o{Escape}');
    expect(trigger).toHaveTextContent('Claude');
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Di luar' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(trigger);
    await user.keyboard('o{Enter}');
    expect(trigger).toHaveTextContent('OpenAI');
  });
  it('anchors above a bottom composer using layout viewport coordinates', async () => {
    const viewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 0, width: 0 } });
    try {
      render(<Fixture />);
      const trigger = screen.getByLabelText('Provider');
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 740, left: 100, width: 44 } as DOMRect);
      await userEvent.click(trigger);
      const menu = screen.getByRole('listbox');
      expect(menu).toHaveAttribute('data-side', 'top');
      expect(menu.style.top).toBe('694px');
      expect(menu.style.bottom).toBe('');
      expect(Number.parseFloat(menu.style.width)).toBeGreaterThan(0);
    } finally {
      if (viewport) Object.defineProperty(window, 'visualViewport', viewport);
      else Reflect.deleteProperty(window, 'visualViewport');
      vi.restoreAllMocks();
    }
  });
  it('does not open disabled fields or submit the containing form', async () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><Dropdown aria-label="Aktif" value="a" onChange={() => {}}><option value="a">A</option></Dropdown>
      <Dropdown aria-label="Nonaktif" disabled value="a" onChange={() => {}}><option value="a">A</option></Dropdown></form>);
    await userEvent.click(screen.getByLabelText('Nonaktif'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Aktif'));
    expect(submit).not.toHaveBeenCalled();
  });
});
