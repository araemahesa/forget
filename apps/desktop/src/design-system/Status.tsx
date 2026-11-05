export function Status({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'error' | 'success' }) {
  return <p aria-live="polite" className={`status status-${tone}`}>{children}</p>;
}
