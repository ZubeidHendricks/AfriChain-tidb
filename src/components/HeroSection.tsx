/**
 * Hero Section Component
 * 
 * Main hero section with VeriChain X branding and glassmorphic effects
 */

import React from 'react';
import { Box, Typography, Button, Container, Stack } from '@mui/material';
import { styled } from '@mui/material/styles';
import { GlassmorphicCard } from './GlassmorphicCard';
import SecurityIcon from '@mui/icons-material/Security';
import VerifiedIcon from '@mui/icons-material/Verified';

const HeroContainer = styled(Box)(({ theme }) => ({
  minHeight: '100vh',
  background: `
    radial-gradient(circle at 30% 20%, rgba(255, 215, 0, 0.15) 0%, transparent 40%),
    radial-gradient(circle at 70% 80%, rgba(255, 165, 0, 0.12) 0%, transparent 40%),
    radial-gradient(circle at 90% 10%, rgba(255, 215, 0, 0.08) 0%, transparent 30%),
    linear-gradient(135deg, #000000 0%, #1a1a1a 30%, #2d2d2d 60%, #1a1a1a 90%, #000000 100%)
  `,
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
  overflow: 'hidden',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: `
      repeating-linear-gradient(
        90deg,
        transparent,
        transparent 98px,
        rgba(255, 215, 0, 0.03) 100px
      ),
      repeating-linear-gradient(
        0deg,
        transparent,
        transparent 98px,
        rgba(255, 215, 0, 0.03) 100px
      )
    `,
    pointerEvents: 'none',
  },
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'linear-gradient(45deg, rgba(255, 215, 0, 0.05) 25%, transparent 25%, transparent 75%, rgba(255, 215, 0, 0.05) 75%)',
    backgroundSize: '60px 60px',
    opacity: 0.3,
    pointerEvents: 'none',
  },
}));

const FloatingElement = styled(Box)<{ delay?: number }>(({ delay = 0 }) => ({
  animation: `float 6s ease-in-out infinite ${delay}s`,
  '@keyframes float': {
    '0%, 100%': {
      transform: 'translateY(0px)',
    },
    '50%': {
      transform: 'translateY(-20px)',
    },
  },
}));

const GradientText = styled(Typography)(({ theme }) => ({
  background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FFD700 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  textAlign: 'center',
  fontWeight: 800,
  letterSpacing: '-0.02em',
}));

const PremiumButton = styled(Button)(({ theme }) => ({
  background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
  color: '#000000',
  fontWeight: 700,
  fontSize: '1.125rem',
  padding: '16px 48px',
  borderRadius: '50px',
  textTransform: 'none',
  boxShadow: '0 8px 32px rgba(255, 215, 0, 0.3)',
  border: '2px solid transparent',
  position: 'relative',
  overflow: 'hidden',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'linear-gradient(135deg, #FFA500 0%, #FFD700 100%)',
    opacity: 0,
    transition: 'opacity 0.3s ease',
  },
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: '0 12px 48px rgba(255, 215, 0, 0.4)',
    '&::before': {
      opacity: 1,
    },
  },
  '& .MuiButton-label': {
    position: 'relative',
    zIndex: 1,
  },
}));

export const HeroSection: React.FC = () => {
  return (
    <HeroContainer>
      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 2 }}>
        <Stack spacing={6} alignItems="center" textAlign="center">
          {/* Floating decorative elements */}
          <FloatingElement delay={0}>
            <SecurityIcon sx={{ fontSize: 60, color: '#FFD700', opacity: 0.3 }} />
          </FloatingElement>
          
          {/* Main branding */}
          <Stack spacing={4} alignItems="center">
            <GradientText variant="h1" component="h1">
              VeriChain X
            </GradientText>
            
            <Typography
              variant="h4"
              component="h2"
              sx={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontWeight: 300,
                maxWidth: '800px',
                lineHeight: 1.4,
              }}
            >
              Revolutionary Multi-Agent AI + Blockchain Platform
            </Typography>
            
            <Typography
              variant="h6"
              component="p"
              sx={{
                color: 'rgba(255, 255, 255, 0.7)',
                fontWeight: 400,
                maxWidth: '600px',
                lineHeight: 1.6,
              }}
            >
              Detecting, verifying, and protecting against counterfeit products across global supply chains using Hedera Hashgraph's enterprise-grade infrastructure
            </Typography>
          </Stack>

          {/* Glassmorphic feature cards */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mt: 6 }}>
            <FloatingElement delay={0.5}>
              <GlassmorphicCard sx={{ p: 3, minWidth: 200 }}>
                <Stack spacing={2} alignItems="center">
                  <SecurityIcon sx={{ fontSize: 40, color: '#FFD700' }} />
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    AI-Powered Detection
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', textAlign: 'center' }}>
                    95%+ accuracy in counterfeit identification
                  </Typography>
                </Stack>
              </GlassmorphicCard>
            </FloatingElement>

            <FloatingElement delay={1}>
              <GlassmorphicCard sx={{ p: 3, minWidth: 200 }}>
                <Stack spacing={2} alignItems="center">
                  <VerifiedIcon sx={{ fontSize: 40, color: '#FFD700' }} />
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    Blockchain Verified
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', textAlign: 'center' }}>
                    Immutable proof on Hedera network
                  </Typography>
                </Stack>
              </GlassmorphicCard>
            </FloatingElement>

            <FloatingElement delay={1.5}>
              <GlassmorphicCard sx={{ p: 3, minWidth: 200 }}>
                <Stack spacing={2} alignItems="center">
                  <Box sx={{ fontSize: 40, color: '#FFD700' }}>⚡</Box>
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    Real-Time Analysis
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', textAlign: 'center' }}>
                    Sub-second response times
                  </Typography>
                </Stack>
              </GlassmorphicCard>
            </FloatingElement>
          </Stack>

          {/* CTA Button */}
          <Box sx={{ mt: 8 }}>
            <PremiumButton
              size="large"
              onClick={() => {
                // Open the real admin dashboard
                window.open('https://verichain-x-hedera.vercel.app/admin', '_blank');
              }}
            >
              Enter Admin Portal
            </PremiumButton>
          </Box>
        </Stack>
      </Container>
    </HeroContainer>
  );
};