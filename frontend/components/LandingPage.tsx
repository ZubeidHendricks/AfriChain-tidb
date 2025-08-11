/**
 * VeriChain X Landing Page
 * 
 * Main landing page component combining all sections
 */

import React from 'react';
import { Box } from '@mui/material';
import { HeroSection } from './HeroSection';
import { AgentShowcase } from './AgentShowcase';
import { AdminPreview } from './AdminPreview';
import { BlockchainSection } from './BlockchainSection';
import { Footer } from './Footer';

export const LandingPage: React.FC = () => {
  return (
    <Box>
      <HeroSection />
      <AgentShowcase />
      <AdminPreview />
      <BlockchainSection />
      <Footer />
    </Box>
  );
};