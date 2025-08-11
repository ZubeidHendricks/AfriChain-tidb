/**
 * Main dashboard component with overview metrics and visualizations.
 * 
 * This component displays system status, key metrics, charts, and
 * recent activity in a responsive grid layout.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Skeleton,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { apiService } from '@services/api';
import { webSocketService } from '@services/websocket';
import { SystemStatusCards } from './SystemStatusCards';
import { DetectionMetricsChart } from './DetectionMetricsChart';
import { RecentActivityFeed } from './RecentActivityFeed';
import { ProductStatusGrid } from './ProductStatusGrid';
import { SupplierPerformanceChart } from './SupplierPerformanceChart';
import { SystemHealthMonitor } from './SystemHealthMonitor';
import { QuickActions } from './QuickActions';

export const Dashboard: React.FC = () => {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');

  // Fetch system status
  const { data: systemStatus, isLoading: statusLoading, error: statusError } = useQuery({
    queryKey: ['system-status'],
    queryFn: () => apiService.getSystemStatus(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch metrics summary
  const { data: metricsSummary, isLoading: metricsLoading } = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: () => apiService.getMetricsSummary({
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      end: new Date(),
    }),
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch detection metrics
  const { data: detectionMetrics, isLoading: detectionLoading } = useQuery({
    queryKey: ['detection-metrics'],
    queryFn: () => apiService.getDetectionMetrics({
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      end: new Date(),
    }),
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  // Set up WebSocket connection for real-time updates
  useEffect(() => {
    const connectWebSocket = async () => {
      try {
        setConnectionStatus('connecting');
        await webSocketService.connect();
        setConnectionStatus('connected');
      } catch (error) {
        console.error('WebSocket connection failed:', error);
        setConnectionStatus('disconnected');
      }
    };

    connectWebSocket();

    // Subscribe to dashboard updates
    const unsubscribe = webSocketService.onDashboardUpdate((update) => {
      console.log('Dashboard update received:', update);
      // Handle real-time updates here
      // For now, we'll just trigger a refetch of relevant data
    });

    return () => {
      unsubscribe();
      webSocketService.disconnect();
    };
  }, []);

  const isLoading = statusLoading || metricsLoading || detectionLoading;

  if (statusError) {
    return (
      <Box p={3}>
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load dashboard data: {statusError.message}
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          Dashboard Overview
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Real-time monitoring of counterfeit detection system
        </Typography>
      </Box>

      {/* Connection status alert */}
      {connectionStatus !== 'connected' && (
        <Alert 
          severity={connectionStatus === 'connecting' ? 'info' : 'warning'} 
          sx={{ mb: 3 }}
        >
          {connectionStatus === 'connecting' 
            ? 'Connecting to real-time updates...' 
            : 'Real-time updates unavailable. Data may not be current.'}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* System Status Cards */}
        <Grid item xs={12}>
          {isLoading ? (
            <Grid container spacing={2}>
              {[1, 2, 3, 4].map((i) => (
                <Grid item xs={12} sm={6} md={3} key={i}>
                  <Skeleton variant="rectangular" height={120} />
                </Grid>
              ))}
            </Grid>
          ) : (
            <SystemStatusCards 
              systemStatus={systemStatus}
              metricsSummary={metricsSummary}
            />
          )}
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12} md={4}>
          <QuickActions />
        </Grid>

        {/* System Health Monitor */}
        <Grid item xs={12} md={8}>
          {isLoading ? (
            <Skeleton variant="rectangular" height={200} />
          ) : (
            <SystemHealthMonitor systemStatus={systemStatus} />
          )}
        </Grid>

        {/* Detection Metrics Chart */}
        <Grid item xs={12} lg={8}>
          {isLoading ? (
            <Skeleton variant="rectangular" height={400} />
          ) : (
            <DetectionMetricsChart data={detectionMetrics} />
          )}
        </Grid>

        {/* Recent Activity Feed */}
        <Grid item xs={12} lg={4}>
          <RecentActivityFeed />
        </Grid>

        {/* Product Status Grid */}
        <Grid item xs={12} lg={8}>
          <ProductStatusGrid />
        </Grid>

        {/* Supplier Performance Chart */}
        <Grid item xs={12} lg={4}>
          {isLoading ? (
            <Skeleton variant="rectangular" height={300} />
          ) : (
            <SupplierPerformanceChart />
          )}
        </Grid>

        {/* Additional Metrics Cards */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Detection Accuracy" />
            <CardContent>
              {isLoading ? (
                <Skeleton variant="text" height={60} />
              ) : (
                <Box>
                  <Typography variant="h3" color="primary.main">
                    {detectionMetrics?.false_positive_rate_percent 
                      ? (100 - detectionMetrics.false_positive_rate_percent).toFixed(1) 
                      : '0'}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    System accuracy in the last 7 days
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Processing Speed" />
            <CardContent>
              {isLoading ? (
                <Skeleton variant="text" height={60} />
              ) : (
                <Box>
                  <Typography variant="h3" color="success.main">
                    {detectionMetrics?.processing_metrics?.avg_processing_time_ms 
                      ? (detectionMetrics.processing_metrics.avg_processing_time_ms / 1000).toFixed(1)
                      : '0'}s
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Average analysis time per product
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};