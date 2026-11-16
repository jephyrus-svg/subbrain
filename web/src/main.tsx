import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppDataProvider } from './components/AppData';
import { ToastProvider } from './components/Toast';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AppDataProvider>
          <App />
        </AppDataProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

// 개발용: 콘솔·통합 점검 스크립트(scripts/live-check.mjs)에서 쓰는 손잡이
if (import.meta.env.DEV) {
  void Promise.all([import('./api/endpoints'), import('./api/client')]).then(([e, c]) => {
    (window as unknown as { __subbrain: unknown }).__subbrain = { api: e.api, collectAll: e.collectAll, dataMode: c.dataMode, request: c.request, ApiRequestError: c.ApiRequestError };
  });
}
