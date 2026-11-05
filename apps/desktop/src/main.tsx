import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/global.css';
import './app/workspace-layout.css';
import './design-system/controls.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import './features/shared/workspace-overlays.css';

import './features/settings/settings-layout.css';
