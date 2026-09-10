import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from '@/api/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/overlays';
import { Toaster } from '@/components/ui/toast';
import { applyAppearance, useUiStore } from '@/store/ui';
import { App } from './App';
import './styles/theme.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // The backend is local; a stale-while-revalidate window of a few
            // seconds is plenty and keeps navigation instant.
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
                // Auth and CSRF failures are handled in the client; retrying a
                // 4xx just delays the real error.
                if (error instanceof ApiError && error.status < 500) {
                    return false;
                }
                return failureCount < 2;
            },
        },
    },
});

// Project persisted appearance onto the document, and keep it in sync as the
// store changes from anywhere in the app.
applyAppearance(useUiStore.getState());
useUiStore.subscribe(applyAppearance);

const container = document.getElementById('root');
if (!container) {
    throw new Error('The #root element is missing from index.html.');
}

createRoot(container).render(
    <StrictMode>
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <TooltipProvider>
                    <BrowserRouter basename={import.meta.env.BASE_URL}>
                        <App />
                    </BrowserRouter>
                    <Toaster />
                </TooltipProvider>
            </QueryClientProvider>
        </ErrorBoundary>
    </StrictMode>,
);
