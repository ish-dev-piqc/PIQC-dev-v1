import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// One-time cleanup: the old MockCalendarToggle stored its state under
// piq-site-mock-calendar-v1. The replacement (Demo Mode) uses
// piq-demo-active-v1 + a server flag. Remove the stale key so users who
// previously flipped the old toggle don't carry confusing state forward.
try {
  localStorage.removeItem('piq-site-mock-calendar-v1');
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
