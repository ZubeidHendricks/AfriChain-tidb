/**
 * Main App component for the Counterfeit Detection Admin Dashboard.
 * 
 * This component sets up the main application structure including
 * routing, theme provider, query client, and global error handling.
 */

import React, { Suspense } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { ErrorBoundary } from 'react-error-boundary';

import { createTheme } from '@utils/theme';
import { AppRoutes } from './routes';
import { AuthProvider } from '@components/auth/AuthProvider';
import { WebSocketProvider } from '@components/providers/WebSocketProvider';
import { ErrorFallback } from '@components/common/ErrorFallback';
import { LoadingScreen } from '@components/common/LoadingScreen';
import { NotificationProvider } from '@components/providers/NotificationProvider';

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

// Create Material-UI theme
const theme = createTheme('light'); // TODO: Add theme switching

function App() {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, errorInfo) => {
        console.error('Application error:', error, errorInfo);
        // TODO: Send error to monitoring service
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <AuthProvider>
              <WebSocketProvider>
                <NotificationProvider>
                  <Suspense fallback={<LoadingScreen />}>
                    <AppRoutes />
                  </Suspense>
                </NotificationProvider>
              </WebSocketProvider>
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;