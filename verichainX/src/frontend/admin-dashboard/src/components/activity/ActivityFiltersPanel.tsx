/**
 * Activity filters panel component - placeholder.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { ActivityFilters } from '@types';

interface ActivityFiltersPanelProps {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
}

export const ActivityFiltersPanel: React.FC<ActivityFiltersPanelProps> = ({
  filters,
  onChange,
}) => {
  return (
    <Box>
      <Typography color="text.secondary">
        Activity filters panel coming soon...
      </Typography>
    </Box>
  );
};