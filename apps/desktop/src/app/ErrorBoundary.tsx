import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { error: Error | null };
/** Last-resort fallback so a render failure never leaves a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ForgeKit gagal menampilkan antarmuka.', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-error-boundary" role="alert" style={{ padding: 32, display: 'grid', gap: 12, maxWidth: 560 }}>
      <h1>Terjadi kesalahan pada tampilan</h1>
      <p>ForgeKit Studio mengalami masalah tak terduga. Draf dan hasil yang sudah tersimpan tetap aman. Muat ulang aplikasi untuk melanjutkan.</p>
      <small>{this.state.error.message}</small>
      <div><button className="button primary-button" type="button" onClick={() => location.reload()}>Muat ulang</button></div>
    </main>;
  }
}
