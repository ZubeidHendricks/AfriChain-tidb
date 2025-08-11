/**
 * Glassmorphic Card Component
 * 
 * Reusable card component with glassmorphic styling
 */

import React from 'react';
import { Paper, PaperProps } from '@mui/material';
import { styled } from '@mui/material/styles';

interface GlassmorphicCardProps extends PaperProps {
  blur?: number;
  opacity?: number;
}

const StyledGlassmorphicCard = styled(Paper)<GlassmorphicCardProps>(({ theme, blur = 20, opacity = 0.1 }) => ({
  background: `rgba(255, 215, 0, ${opacity})`,
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
  border: '1px solid rgba(255, 215, 0, 0.2)',
  borderRadius: '20px',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  '&:hover': {
    background: `rgba(255, 215, 0, ${opacity + 0.05})`,
    transform: 'translateY(-4px)',
    boxShadow: '0 12px 48px rgba(255, 215, 0, 0.2)',
  },
}));

export const GlassmorphicCard: React.FC<GlassmorphicCardProps> = ({ children, ...props }) => {
  return (
    <StyledGlassmorphicCard elevation={0} {...props}>
      {children}
    </StyledGlassmorphicCard>
  );
};