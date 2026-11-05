export function Button({
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return <button className={`button ${className}`} disabled={disabled} onClick={onClick} type={type}>{children}</button>;
}
