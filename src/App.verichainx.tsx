/**
 * VeriChain X Landing Page App
 * 
 * Main application component for the VeriChain X landing page
 */

import React from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme';
import { LandingPage } from './components/LandingPage';

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LandingPage />
    </ThemeProvider>
  );
}

export default App;