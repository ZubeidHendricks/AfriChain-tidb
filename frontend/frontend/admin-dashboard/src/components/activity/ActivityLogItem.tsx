/**
 * Individual activity log item component.
 * 
 * Displays a single activity entry with type-specific icons,
 * color coding, and expandable details.
 */

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Avatar,
  Chip,
  IconButton,
  Collapse,
  Divider,
  Grid,
  Paper,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
  Memory as MemoryIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';

import {
  ActivityLogEntry,
  getActivityTypeIcon,
  getActivityTypeColor,
  getStatusColor,
  formatDuration,
} from '@types';

interface ActivityLogItemProps {
  activity: ActivityLogEntry;
  groupByProduct?: boolean;
}

export const ActivityLogItem: React.FC<ActivityLogItemProps> = ({
  activity,
  groupByProduct = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  const activityIcon = getActivityTypeIcon(activity.activity_type);
  const activityColor = getActivityTypeColor(activity.activity_type);
  const statusColor = getStatusColor(activity.status);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getIconComponent = (iconName: string) => {
    // Map icon names to actual icon components
    const iconMap: Record<string, React.ElementType> = {
      analytics: () => <span className="material-icons">analytics</span>,
      gavel: () => <span className="material-icons">gavel</span>,
      notifications: () => <span className="material-icons">notifications</span>,
      computer: () => <span className="material-icons">computer</span>,
      security: () => <span className="material-icons">security</span>,
      rule: () => <span className="material-icons">rule</span>,
      person: () => <span className="material-icons">person</span>,
      cloud_upload: () => <span className="material-icons">cloud_upload</span>,
      error: () => <span className="material-icons">error</span>,
      help: () => <span className="material-icons">help</span>,
    };

    const IconComponent = iconMap[iconName] || iconMap.help;
    return <IconComponent />;
  };

  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Box display="flex" alignItems="flex-start" gap={2}>
        {/* Activity icon */}
        <Avatar
          sx={{
            bgcolor: activityColor + '20',
            color: activityColor,
            width: 40,
            height: 40,
          }}
        >
          {getIconComponent(activityIcon)}
        </Avatar>

        {/* Main content */}
        <Box flex={1} minWidth={0}>
          {/* Header */}
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
            <Box flex={1} minWidth={0}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {activity.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {activity.description}
              </Typography>
            </Box>

            {/* Expand button */}
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              sx={{ ml: 1 }}
            >
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>

          {/* Metadata chips */}
          <Box display="flex" flexWrap="wrap" gap={1} mb={1}>
            {/* Status */}
            <Chip
              label={activity.status}
              size="small"
              sx={{
                bgcolor: statusColor + '20',
                color: statusColor,
                borderColor: statusColor,
              }}
              variant="outlined"
            />

            {/* Agent */}
            <Chip
              icon={<PersonIcon />}
              label={activity.agent_name}
              size="small"
              variant="outlined"
            />

            {/* Timing */}
            <Tooltip title={`Started: ${formatTime(activity.started_at)}`}>
              <Chip
                icon={<ScheduleIcon />}
                label={formatTime(activity.started_at)}
                size="small"
                variant="outlined"
              />
            </Tooltip>

            {/* Duration */}
            {activity.duration_ms && (
              <Chip
                icon={<SpeedIcon />}
                label={formatDuration(activity.duration_ms)}
                size="small"
                variant="outlined"
              />
            )}

            {/* Product link (if applicable) */}
            {activity.product_title && (
              <Chip
                label={activity.product_title}
                size="small"
                clickable
                color="primary"
                variant="outlined"
              />
            )}

            {/* Supplier (if applicable) */}
            {activity.supplier_name && (
              <Chip
                label={activity.supplier_name}
                size="small"
                variant="outlined"
              />
            )}
          </Box>

          {/* Expanded details */}
          <Collapse in={expanded}>
            <Paper sx={{ p: 2, mt: 2, bgcolor: 'background.default' }}>
              <Grid container spacing={2}>
                {/* Activity details */}
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" gutterBottom>
                    Activity Details
                  </Typography>
                  <Box sx={{ pl: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Activity Type: {activity.activity_type}
                    </Typography>
                    <br />
                    <Typography variant="caption" color="text.secondary">
                      Agent ID: {activity.agent_id}
                    </Typography>
                    <br />
                    <Typography variant="caption" color="text.secondary">
                      Agent Type: {activity.agent_type}
                    </Typography>
                    <br />
                    {activity.completed_at && (
                      <>
                        <Typography variant="caption" color="text.secondary">
                          Completed: {formatTime(activity.completed_at)}
                        </Typography>
                        <br />
                      </>
                    )}
                    {activity.retry_count && activity.retry_count > 0 && (
                      <>
                        <Typography variant="caption" color="text.secondary">
                          Retries: {activity.retry_count}
                        </Typography>
                        <br />
                      </>
                    )}
                  </Box>
                </Grid>

                {/* Performance metrics */}
                {(activity.processing_time_ms || activity.memory_usage_mb || activity.cpu_usage_percent) && (
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" gutterBottom>
                      Performance Metrics
                    </Typography>
                    <Box sx={{ pl: 1 }}>
                      {activity.processing_time_ms && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            Processing Time: {formatDuration(activity.processing_time_ms)}
                          </Typography>
                          <br />
                        </>
                      )}
                      {activity.memory_usage_mb && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            Memory Usage: {activity.memory_usage_mb.toFixed(1)} MB
                          </Typography>
                          <br />
                        </>
                      )}
                      {activity.cpu_usage_percent && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            CPU Usage: {activity.cpu_usage_percent.toFixed(1)}%
                          </Typography>
                          <br />
                        </>
                      )}
                    </Box>
                  </Grid>
                )}

                {/* Context information */}
                {activity.context && Object.keys(activity.context).length > 0 && (
                  <Grid item xs={12}>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="subtitle2" gutterBottom>
                      Context
                    </Typography>
                    <Box sx={{ pl: 1 }}>
                      {Object.entries(activity.context).map(([key, value]) => (
                        <Typography variant="caption" color="text.secondary" key={key}>
                          {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          <br />
                        </Typography>
                      ))}
                    </Box>
                  </Grid>
                )}

                {/* Error message */}
                {activity.error_message && (
                  <Grid item xs={12}>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="subtitle2" color="error" gutterBottom>
                      Error Details
                    </Typography>
                    <Typography 
                      variant="body2" 
                      color="error" 
                      sx={{ 
                        fontFamily: 'monospace',
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        p: 1,
                        borderRadius: 1,
                        fontSize: '0.75rem',
                      }}
                    >
                      {activity.error_message}
                    </Typography>
                  </Grid>
                )}

                {/* Result data */}
                {activity.result && Object.keys(activity.result).length > 0 && (
                  <Grid item xs={12}>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="subtitle2" gutterBottom>
                      Result
                    </Typography>
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        fontFamily: 'monospace',
                        bgcolor: 'grey.100',
                        p: 1,
                        borderRadius: 1,
                        fontSize: '0.75rem',
                        maxHeight: 200,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(activity.result, null, 2)}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Paper>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
};