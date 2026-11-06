import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import './app/global.css';
import './app/workspace-layout.css';
import './design-system/controls.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

import './features/shared/workspace-overlays.css';

import './features/settings/settings-layout.css';
