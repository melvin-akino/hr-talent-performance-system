import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// Self-hosted, bundled by Vite. The office LAN has no internet, so a webfont
// CDN would leave every screen in the fallback face. Weights are exactly those
// the design system asks for — Barlow 400/500/700, Barlow Condensed 400/600 —
// and nothing more, because each one is bytes on a link staff wait behind.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';

// Order matters: Tailwind's preflight first, then the design system, so the
// Industry component classes win where the two overlap.
import './index.css';
import './styles/industry.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // HR data changes on human timescales, not by the second. Refetching on
      // every window focus would hammer an on-prem box during a review close
      // for no benefit.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // 401s trigger a re-auth redirect inside api(); retrying them just
      // delays that. Retry once for genuine transient failures.
      retry: 1,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
