import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import './app/global.css';
import './app/workspace-layout.css';
import './design-system/controls.css';

// `?mock` on the dev server swaps in a fake backend for layout review; release builds drop it.
const ready = import.meta.env.DEV && new URLSearchParams(location.search).has('mock') ? import('./dev/mockTauri') : Promise.resolve();
void ready.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
));

import './features/shared/workspace-overlays.css';

import './features/settings/settings-layout.css';
import './app/layout-polish.css';
