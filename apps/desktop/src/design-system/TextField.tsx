import { useId } from 'react';

export function TextField({
  label,
  value,
  onChange,
  error,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  error?: string;
  type?: 'text' | 'number';
}) {
  const id = useId();
  const name = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return (
    <label className="field" htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      <input
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={Boolean(error)}
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value}
      />
      {error ? <small className="field-error" id={`${id}-error`}>{error}</small> : null}
    </label>
  );
}
