/**
 * VeriChain X Landing Page Theme Configuration
 * 
 * Glassmorphic gold and black theme for premium blockchain aesthetic
 */

import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#FFD700', // Gold
      light: '#FFA500', // Orange gold
      dark: '#B8860B', // Dark goldenrod
      contrastText: '#000000',
    },
    secondary: {
      main: '#DAA520', // Goldenrod
      light: '#F4E4BC', // Light gold
      dark: '#B8860B', // Dark goldenrod
      contrastText: '#000000',
    },
    background: {
      default: '#000000', // Black
      paper: 'rgba(26, 26, 26, 0.8)', // Dark with transparency for glassmorphic effect
    },
    text: {
      primary: '#FFFFFF', // White
      secondary: '#FFD700', // Gold
      disabled: 'rgba(255, 255, 255, 0.5)',
    },
    grey: {
      50: '#FFFFFF',
      100: '#F5F5F5',
      200: '#EEEEEE',
      300: '#E0E0E0',
      400: '#BDBDBD',
      500: '#9E9E9E',
      600: '#757575',
      700: '#616161',
      800: '#424242',
      900: '#212121',
    },
    common: {
      black: '#000000',
      white: '#FFFFFF',
    },
    divider: 'rgba(255, 215, 0, 0.2)', // Gold divider with transparency
  },
  typography: {
    fontFamily: [
      'Space Grotesk',
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    h1: {
      fontSize: '4rem',
      fontWeight: 700,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      fontFamily: 'Space Grotesk, sans-serif',
    },
    h2: {
      fontSize: '3rem',
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: '-0.01em',
      fontFamily: 'Space Grotesk, sans-serif',
    },
    h3: {
      fontSize: '2.25rem',
      fontWeight: 600,
      lineHeight: 1.2,
      fontFamily: 'Space Grotesk, sans-serif',
    },
    h4: {
      fontSize: '1.875rem',
      fontWeight: 600,
      lineHeight: 1.3,
      fontFamily: 'Space Grotesk, sans-serif',
    },
    h5: {
      fontSize: '1.5rem',
      fontWeight: 600,
      lineHeight: 1.3,
      fontFamily: 'Space Grotesk, sans-serif',
    },
    h6: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: 1.4,
      fontFamily: 'Space Grotesk, sans-serif',
    },
    body1: {
      fontSize: '1.125rem',
      fontWeight: 400,
      lineHeight: 1.6,
      fontFamily: 'Inter, sans-serif',
    },
    body2: {
      fontSize: '1rem',
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: 'Inter, sans-serif',
    },
    button: {
      fontSize: '1rem',
      fontWeight: 600,
      lineHeight: 1.5,
      textTransform: 'none',
      fontFamily: 'Inter, sans-serif',
    },
  },
  shape: {
    borderRadius: 16,
  },
  shadows: [
    'none',
    '0px 4px 20px rgba(255, 215, 0, 0.1)',
    '0px 8px 32px rgba(255, 215, 0, 0.15)',
    '0px 12px 48px rgba(255, 215, 0, 0.2)',
    '0px 16px 64px rgba(255, 215, 0, 0.25)',
    '0px 20px 80px rgba(255, 215, 0, 0.3)',
    '0px 24px 96px rgba(255, 215, 0, 0.35)',
    '0px 28px 112px rgba(255, 215, 0, 0.4)',
    '0px 32px 128px rgba(255, 215, 0, 0.45)',
    '0px 36px 144px rgba(255, 215, 0, 0.5)',
    '0px 40px 160px rgba(255, 215, 0, 0.55)',
    '0px 44px 176px rgba(255, 215, 0, 0.6)',
    '0px 48px 192px rgba(255, 215, 0, 0.65)',
    '0px 52px 208px rgba(255, 215, 0, 0.7)',
    '0px 56px 224px rgba(255, 215, 0, 0.75)',
    '0px 60px 240px rgba(255, 215, 0, 0.8)',
    '0px 64px 256px rgba(255, 215, 0, 0.85)',
    '0px 68px 272px rgba(255, 215, 0, 0.9)',
    '0px 72px 288px rgba(255, 215, 0, 0.95)',
    '0px 76px 304px rgba(255, 215, 0, 1)',
    '0px 80px 320px rgba(255, 215, 0, 1)',
    '0px 84px 336px rgba(255, 215, 0, 1)',
    '0px 88px 352px rgba(255, 215, 0, 1)',
    '0px 92px 368px rgba(255, 215, 0, 1)',
    '0px 96px 384px rgba(255, 215, 0, 1)',
  ],
});

export default theme;