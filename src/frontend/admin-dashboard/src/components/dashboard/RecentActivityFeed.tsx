/**
 * Recent activity feed component.
 * 
 * Displays real-time activity updates in a scrollable feed.
 */

import React from 'react';
import {
  Card,
  CardHeader,
  CardContent,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Box,
  Chip,
  Button,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Analytics as AnalyticsIcon,
  Notifications as NotificationsIcon,
  Gavel as EnforcementIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';

import { apiService } from '@services/api';
import { getActivityTypeIcon, getActivityTypeColor } from '@types/activity';

export const RecentActivityFeed: React.FC = () => {
  // Fetch recent activities
  const { data: activities, isLoading } = useQuery({
    queryKey: ['recent-activities'],
    queryFn: () => apiService.getActivities(
      { time_range: { preset: 'today' } },
      { page: 1, page_size: 20 }
    ),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const getActivityIcon = (activityType: string) => {
    const iconName = getActivityTypeIcon(activityType as any);
    switch (iconName) {
      case 'analytics': return AnalyticsIcon;
      case 'gavel': return EnforcementIcon;
      case 'notifications': return NotificationsIcon;
      case 'computer': return TimelineIcon;
      default: return SecurityIcon;
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return time.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Recent Activity" />
        <CardContent>
          <Typography color="text.secondary">Loading activities...</Typography>
        </CardContent>
      </Card>
    );
  }

  const recentActivities = activities?.activities?.slice(0, 10) || [];

  return (
    <Card sx={{ height: '100%' }}>
      <CardHeader 
        title="Recent Activity"
        action={
          <Button size="small" href="/activity">
            View All
          </Button>
        }
      />
      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
        {recentActivities.length === 0 ? (
          <Box p={3} textAlign="center">
            <Typography color="text.secondary">
              No recent activity
            </Typography>
          </Box>
        ) : (
          <List sx={{ py: 0 }}>
            {recentActivities.map((activity, index) => {
              const ActivityIcon = getActivityIcon(activity.activity_type);
              const iconColor = getActivityTypeColor(activity.activity_type as any);
              
              return (
                <ListItem 
                  key={activity.id}
                  divider={index < recentActivities.length - 1}
                  sx={{ px: 2 }}
                >
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: iconColor + '20', color: iconColor, width: 36, height: 36 }}>
                      <ActivityIcon fontSize="small" />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {activity.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                          {formatTimeAgo(activity.started_at)}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {activity.description}
                        </Typography>
                        <Box display="flex" alignItems="center" mt={0.5} gap={1}>
                          <Chip
                            label={activity.status}
                            size="small"
                            color={
                              activity.status === 'completed' ? 'success' :
                              activity.status === 'failed' ? 'error' :
                              activity.status === 'in_progress' ? 'primary' : 'default'
                            }
                            sx={{ height: 16, fontSize: '0.65rem' }}
                          />
                          {activity.agent_name && (
                            <Typography variant="caption" color="text.secondary">
                              by {activity.agent_name}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </CardContent>
    </Card>
  );
};