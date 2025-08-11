/**
 * System health monitor component - placeholder.
 */

import React from 'react';
import { Card, CardHeader, CardContent, Typography } from '@mui/material';
import { SystemStatus } from '@types';

interface SystemHealthMonitorProps {
  systemStatus?: SystemStatus;
}

export const SystemHealthMonitor: React.FC<SystemHealthMonitorProps> = ({ systemStatus }) => {
  return (
    <Card>
      <CardHeader title="System Health Monitor" />
      <CardContent>
        <Typography color="text.secondary">
          Detailed system health monitoring coming soon...
        </Typography>
      </CardContent>
    </Card>
  );
};