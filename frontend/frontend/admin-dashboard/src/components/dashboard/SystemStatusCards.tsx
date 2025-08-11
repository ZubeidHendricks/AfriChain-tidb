/**
 * System status overview cards component.
 * 
 * Displays key system metrics in card format with color-coded indicators.
 */

import React from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  TrendingFlat,
  Info,
  Security,
  Speed,
  Assessment,
  Warning,
} from '@mui/icons-material';

import { SystemStatus, MetricsSummary, MetricValue } from '@types';
import { formatMetricValue, getTrendIcon, getTrendColor } from '@types/analytics';

interface SystemStatusCardsProps {
  systemStatus?: SystemStatus;
  metricsSummary?: MetricsSummary;
}

interface StatusCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
  icon?: React.ElementType;
  onClick?: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  color = 'primary',
  icon: Icon,
  onClick,
}) => {
  const TrendIcon = trend ? getTrendIcon(trend) === 'trending_up' ? TrendingUp :
                           getTrendIcon(trend) === 'trending_down' ? TrendingDown : TrendingFlat : undefined;

  return (
    <Card 
      sx={{ 
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': onClick ? {
          transform: 'translateY(-2px)',
          boxShadow: 4,
        } : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box flex={1}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4" color={`${color}.main`} gutterBottom>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {Icon && (
            <Box>
              <Icon sx={{ color: `${color}.main`, fontSize: 32 }} />
            </Box>
          )}
        </Box>
        
        {trend && trendValue && (
          <Box display="flex" alignItems="center" mt={1}>
            {TrendIcon && (
              <TrendIcon 
                sx={{ 
                  fontSize: 16, 
                  mr: 0.5, 
                  color: getTrendColor(trend, trend === 'up') 
                }} 
              />
            )}
            <Typography 
              variant="caption" 
              sx={{ 
                color: getTrendColor(trend, trend === 'up'),
                fontWeight: 500,
              }}
            >
              {trendValue}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export const SystemStatusCards: React.FC<SystemStatusCardsProps> = ({
  systemStatus,
  metricsSummary,
}) => {
  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'success';
      case 'warning': return 'warning';
      case 'critical': return 'error';
      default: return 'info';
    }
  };

  const formatTrendValue = (metric: MetricValue) => {
    if (!metric.change_percent) return '';
    const sign = metric.change_percent > 0 ? '+' : '';
    return `${sign}${metric.change_percent.toFixed(1)}%`;
  };

  return (
    <Grid container spacing={3}>
      {/* Total Products */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="Total Products"
          value={metricsSummary?.products.total ? formatMetricValue(metricsSummary.products.total) : '0'}
          subtitle="Products analyzed"
          trend={metricsSummary?.products.total.trend}
          trendValue={metricsSummary?.products.total ? formatTrendValue(metricsSummary.products.total) : undefined}
          color="primary"
          icon={Assessment}
        />
      </Grid>

      {/* Products Flagged Today */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="Flagged Today"
          value={metricsSummary?.products.flagged_today ? formatMetricValue(metricsSummary.products.flagged_today) : '0'}
          subtitle="Potential counterfeits"
          trend={metricsSummary?.products.flagged_today.trend}
          trendValue={metricsSummary?.products.flagged_today ? formatTrendValue(metricsSummary.products.flagged_today) : undefined}
          color="warning"
          icon={Security}
        />
      </Grid>

      {/* Detection Rate */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="Detection Rate"
          value={metricsSummary?.products.detection_rate ? formatMetricValue(metricsSummary.products.detection_rate) : '0%'}
          subtitle="System accuracy"
          trend={metricsSummary?.products.detection_rate.trend}
          trendValue={metricsSummary?.products.detection_rate ? formatTrendValue(metricsSummary.products.detection_rate) : undefined}
          color="success"
          icon={Speed}
        />
      </Grid>

      {/* System Health */}
      <Grid item xs={12} sm={6} md={3}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start">
              <Box flex={1}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  System Health
                </Typography>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <Chip
                    label={systemStatus?.overall_health || 'Unknown'}
                    color={getHealthColor(systemStatus?.overall_health || 'info')}
                    size="small"
                    sx={{ textTransform: 'capitalize' }}
                  />
                  <Tooltip title="View detailed system status">
                    <IconButton size="small">
                      <Info fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {systemStatus?.active_connections || 0} active connections
                </Typography>
              </Box>
              <Box>
                {systemStatus?.overall_health === 'critical' ? (
                  <Warning sx={{ color: 'error.main', fontSize: 32 }} />
                ) : (
                  <Security sx={{ color: getHealthColor(systemStatus?.overall_health || 'info') + '.main', fontSize: 32 }} />
                )}
              </Box>
            </Box>

            {/* Component status indicators */}
            <Box mt={2}>
              <Grid container spacing={1}>
                {systemStatus?.components && Object.entries(systemStatus.components).map(([component, status]) => (
                  <Grid item xs={6} key={component}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: status === 'healthy' ? 'success.main' :
                                         status === 'warning' ? 'warning.main' : 'error.main',
                        }}
                      />
                      <Typography variant="caption" sx={{ textTransform: 'capitalize' }}>
                        {component.replace('_', ' ')}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Active Agents */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="Active Agents"
          value={metricsSummary?.agents.active_agents ? formatMetricValue(metricsSummary.agents.active_agents) : '0'}
          subtitle="Processing requests"
          trend={metricsSummary?.agents.active_agents.trend}
          trendValue={metricsSummary?.agents.active_agents ? formatTrendValue(metricsSummary.agents.active_agents) : undefined}
          color="info"
          icon={Speed}
        />
      </Grid>

      {/* Response Time */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="Avg Response Time"
          value={metricsSummary?.agents.avg_response_time ? formatMetricValue(metricsSummary.agents.avg_response_time) : '0ms'}
          subtitle="Agent processing"
          trend={metricsSummary?.agents.avg_response_time.trend}
          trendValue={metricsSummary?.agents.avg_response_time ? formatTrendValue(metricsSummary.agents.avg_response_time) : undefined}
          color="primary"
          icon={Speed}
        />
      </Grid>

      {/* False Positive Rate */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="False Positive Rate"
          value={metricsSummary?.products.false_positive_rate ? formatMetricValue(metricsSummary.products.false_positive_rate) : '0%'}
          subtitle="System precision"
          trend={metricsSummary?.products.false_positive_rate.trend}
          trendValue={metricsSummary?.products.false_positive_rate ? formatTrendValue(metricsSummary.products.false_positive_rate) : undefined}
          color={parseFloat(formatMetricValue(metricsSummary?.products.false_positive_rate || { value: 0, trend: 'stable', format: 'percentage' }).replace('%', '')) > 5 ? 'warning' : 'success'}
          icon={Assessment}
        />
      </Grid>

      {/* Enforcement Actions */}
      <Grid item xs={12} sm={6} md={3}>
        <StatusCard
          title="Enforcement Actions"
          value={metricsSummary?.enforcement.total_actions ? formatMetricValue(metricsSummary.enforcement.total_actions) : '0'}
          subtitle="Last 24 hours"
          trend={metricsSummary?.enforcement.total_actions.trend}
          trendValue={metricsSummary?.enforcement.total_actions ? formatTrendValue(metricsSummary.enforcement.total_actions) : undefined}
          color="warning"
          icon={Security}
        />
      </Grid>
    </Grid>
  );
};