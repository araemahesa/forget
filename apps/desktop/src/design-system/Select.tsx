import { Dropdown } from './Dropdown';
import { useId } from 'react';

export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const name = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <Dropdown aria-label={label} id={id} name={name} disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Dropdown>
    </label>
  );
}
