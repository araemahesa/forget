import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Exercise the same visible listbox interaction as the application user. */
export async function selectChoice(control: HTMLElement, value: string) {
  if (control.getAttribute('aria-expanded') !== 'true') await userEvent.click(control);
  const option = screen.getAllByRole('option').find((node) => node.getAttribute('data-value') === value);
  if (!option) throw new Error(`Dropdown option not found: ${value}`);
  await userEvent.click(option);
}
