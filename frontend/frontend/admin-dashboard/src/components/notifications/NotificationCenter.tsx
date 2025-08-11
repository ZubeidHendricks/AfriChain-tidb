/**
 * Notification center component - placeholder.
 */

import React from 'react';
import { Drawer, Typography, Box } from '@mui/material';

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ open, onClose }) => {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 300, p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Notifications
        </Typography>
        <Typography color="text.secondary">
          No new notifications
        </Typography>
      </Box>
    </Drawer>
  );
};