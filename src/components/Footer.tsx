/**
 * Footer Component
 * 
 * Minimalist footer with company information and links
 */

import React from 'react';
import { Box, Typography, Container, Stack, Link } from '@mui/material';
import { styled } from '@mui/material/styles';

const FooterContainer = styled(Box)(({ theme }) => ({
  background: 'linear-gradient(180deg, #0a0a0a 0%, #000000 100%)',
  padding: '60px 0 30px',
  borderTop: '1px solid rgba(255, 215, 0, 0.1)',
}));

export const Footer: React.FC = () => {
  return (
    <FooterContainer>
      <Container maxWidth="lg">
        <Stack spacing={4}>
          {/* Main Footer Content */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={4}
            justifyContent="space-between"
            alignItems={{ xs: 'center', md: 'flex-start' }}
          >
            {/* Brand */}
            <Stack spacing={2} alignItems={{ xs: 'center', md: 'flex-start' }}>
              <Typography
                variant="h4"
                sx={{
                  background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  fontWeight: 700,
                }}
              >
                VeriChain X
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  maxWidth: '300px',
                  textAlign: { xs: 'center', md: 'left' },
                }}
              >
                Revolutionary Multi-Agent AI + Blockchain Platform for counterfeit detection and brand protection
              </Typography>
            </Stack>

            {/* Links */}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={4}
              alignItems={{ xs: 'center', md: 'flex-start' }}
            >
              <Stack spacing={2} alignItems={{ xs: 'center', md: 'flex-start' }}>
                <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                  Product
                </Typography>
                <Stack spacing={1} alignItems={{ xs: 'center', md: 'flex-start' }}>
                  <Link href="#admin-section" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    Features
                  </Link>
                  <Link href="https://verichain-x-hedera.vercel.app/docs" target="_blank" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    API Documentation
                  </Link>
                  <Link href="https://verichain-x-hedera.vercel.app/admin" target="_blank" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    Admin Portal
                  </Link>
                </Stack>
              </Stack>

              <Stack spacing={2} alignItems={{ xs: 'center', md: 'flex-start' }}>
                <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                  Company
                </Typography>
                <Stack spacing={1} alignItems={{ xs: 'center', md: 'flex-start' }}>
                  <Link href="#" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    About Us
                  </Link>
                  <Link href="#" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    Contact
                  </Link>
                  <Link href="#" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    Careers
                  </Link>
                </Stack>
              </Stack>

              <Stack spacing={2} alignItems={{ xs: 'center', md: 'flex-start' }}>
                <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                  Resources
                </Typography>
                <Stack spacing={1} alignItems={{ xs: 'center', md: 'flex-start' }}>
                  <Link href="https://verichain-x-hedera.vercel.app/docs" target="_blank" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    Documentation
                  </Link>
                  <Link href="https://github.com/ZubeidHendricks/verichainX-hedera" target="_blank" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    GitHub
                  </Link>
                  <Link href="https://verichain-x-hedera.vercel.app/api/v1/health" target="_blank" sx={{ color: 'rgba(255, 255, 255, 0.8)', textDecoration: 'none', '&:hover': { color: '#FFD700' } }}>
                    API Status
                  </Link>
                </Stack>
              </Stack>
            </Stack>
          </Stack>

          {/* Bottom Bar */}
          <Box
            sx={{
              pt: 4,
              borderTop: '1px solid rgba(255, 215, 0, 0.1)',
            }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography
                variant="body2"
                sx={{ color: 'rgba(255, 255, 255, 0.6)' }}
              >
                © 2025 VeriChain X. All rights reserved.
              </Typography>
              
              <Stack direction="row" spacing={3}>
                <Link
                  href="#"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    '&:hover': { color: '#FFD700' },
                  }}
                >
                  Privacy Policy
                </Link>
                <Link
                  href="#"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    '&:hover': { color: '#FFD700' },
                  }}
                >
                  Terms of Service
                </Link>
                <Link
                  href="#"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.6)',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    '&:hover': { color: '#FFD700' },
                  }}
                >
                  Cookie Policy
                </Link>
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </Container>
    </FooterContainer>
  );
};