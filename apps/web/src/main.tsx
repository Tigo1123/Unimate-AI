import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './app/auth';
import { initializeTheme } from './app/theme';
import { applyLanguage, I18nProvider, preferredLanguage } from './i18n';
import './index.css';
initializeTheme();
applyLanguage(preferredLanguage());
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <I18nProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </I18nProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
