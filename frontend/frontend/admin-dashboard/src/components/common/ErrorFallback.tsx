/**
 * Error fallback component for error boundaries.
 */

import React from 'react';
import { Box, Button, Typography, Container, Paper } from '@mui/material';
import { ErrorOutline, Refresh } from '@mui/icons-material';

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  resetErrorBoundary,
}) => {
  return (
    <Container maxWidth="md">
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
        textAlign="center"
        gap={3}
      >
        <Paper
          elevation={2}
          sx={{
            p: 4,
            borderRadius: 2,
            maxWidth: 500,
            width: '100%',
          }}
        >
          <ErrorOutline
            sx={{
              fontSize: 64,
              color: 'error.main',
              mb: 2,
            }}
          />
          
          <Typography variant="h4" gutterBottom>
            Something went wrong
          </Typography>
          
          <Typography variant="body1" color="text.secondary" paragraph>
            We're sorry, but something unexpected happened. Please try refreshing the page.
          </Typography>
          
          {process.env.NODE_ENV === 'development' && (
            <Box
              component="details"
              sx={{
                mt: 2,
                p: 2,
                backgroundColor: 'grey.100',
                borderRadius: 1,
                textAlign: 'left',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
                Error Details (Development)
              </summary>
              <Typography
                component="pre"
                variant="caption"
                sx={{
                  mt: 1,
                  overflow: 'auto',
                  fontSize: '0.75rem',
                  lineHeight: 1.4,
                }}
              >
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </Typography>
            </Box>
          )}
          
          <Box mt={3} gap={2} display="flex" justifyContent="center">
            <Button
              variant="contained"
              startIcon={<Refresh />}
              onClick={resetErrorBoundary}
            >
              Try Again
            </Button>
            
            <Button
              variant="outlined"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};