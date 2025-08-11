/**
 * Activity monitoring page.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { ActivityLogViewer } from './ActivityLogViewer';

export const ActivityPage: React.FC = () => {
  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          System Activity
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Monitor agent activities and system events in real-time
        </Typography>
      </Box>
      
      <ActivityLogViewer 
        enableRealTime={true}
        maxHeight={800}
      />
    </Box>
  );
};