/**
 * Admin Dashboard Preview Component
 * 
 * Preview of the admin dashboard functionality
 */

import React, { useState, useEffect } from 'react';
import { Box, Typography, Container, Stack, Button, Avatar, Chip } from '@mui/material';
import { styled } from '@mui/material/styles';
import { GlassmorphicCard } from './GlassmorphicCard';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SecurityIcon from '@mui/icons-material/Security';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { apiService, SystemMetrics, DetectionActivity } from '../services/api';

const AdminContainer = styled(Box)(({ theme }) => ({
  background: 'linear-gradient(180deg, #1a1a1a 0%, #000000 100%)',
  padding: '120px 0',
  position: 'relative',
}));

const MetricCard = styled(GlassmorphicCard)(({ theme }) => ({
  padding: '24px',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
}));

const PremiumButton = styled(Button)(({ theme }) => ({
  background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
  color: '#000000',
  fontWeight: 700,
  fontSize: '1.125rem',
  padding: '16px 48px',
  borderRadius: '50px',
  textTransform: 'none',
  boxShadow: '0 8px 32px rgba(255, 215, 0, 0.3)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: '0 12px 48px rgba(255, 215, 0, 0.4)',
  },
}));

// Mock data for charts
const detectionData = [
  { name: 'Jan', detections: 1200, verified: 1150 },
  { name: 'Feb', detections: 1900, verified: 1820 },
  { name: 'Mar', detections: 2400, verified: 2350 },
  { name: 'Apr', detections: 2100, verified: 2050 },
  { name: 'May', detections: 2800, verified: 2720 },
  { name: 'Jun', detections: 3200, verified: 3100 },
];

const realtimeData = [
  { time: '00:00', value: 45 },
  { time: '04:00', value: 52 },
  { time: '08:00', value: 78 },
  { time: '12:00', value: 95 },
  { time: '16:00', value: 87 },
  { time: '20:00', value: 63 },
];


export const AdminPreview: React.FC = () => {
  const [liveMetrics, setLiveMetrics] = useState<SystemMetrics>({
    totalScanned: 45672,
    counterfeitsDetected: 3421,
    accuracyRate: 98.7,
    activeAgents: 5,
  });
  const [recentActivity, setRecentActivity] = useState<DetectionActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initial data fetch
    const fetchData = async () => {
      try {
        const [metrics, activity] = await Promise.all([
          apiService.getSystemMetrics(),
          apiService.getRecentActivity(),
        ]);
        setLiveMetrics(metrics);
        setRecentActivity(activity);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Set up periodic updates
    const interval = setInterval(async () => {
      try {
        const metrics = await apiService.getSystemMetrics();
        setLiveMetrics(metrics);
      } catch (error) {
        // Fallback to incremental updates if API fails
        setLiveMetrics(prev => ({
          ...prev,
          totalScanned: prev.totalScanned + Math.floor(Math.random() * 3),
          counterfeitsDetected: prev.counterfeitsDetected + (Math.random() > 0.7 ? 1 : 0),
        }));
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const getRiskColor = (type: string) => {
    switch (type) {
      case 'High Risk': return '#FF5722';
      case 'Medium Risk': return '#FF9800';
      case 'Verified': return '#4CAF50';
      default: return '#FFD700';
    }
  };

  return (
    <AdminContainer id="admin-section">
      <Container maxWidth="lg">
        <Stack spacing={8}>
          {/* Header */}
          <Stack spacing={3} alignItems="center" textAlign="center">
            <Typography
              variant="h2"
              sx={{
                background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontWeight: 700,
              }}
            >
              Admin Dashboard
            </Typography>
            <Typography
              variant="h6"
              sx={{
                color: 'rgba(255, 255, 255, 0.8)',
                maxWidth: '600px',
                lineHeight: 1.6,
              }}
            >
              Real-time monitoring and control of your counterfeit detection system
            </Typography>
          </Stack>

          {/* Live Metrics */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            <MetricCard>
              <Stack spacing={2}>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <SecurityIcon sx={{ color: '#FFD700', fontSize: 32 }} />
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    Total Scanned
                  </Typography>
                </Stack>
                <Typography variant="h3" sx={{ color: '#FFFFFF', fontWeight: 700 }}>
                  {liveMetrics.totalScanned.toLocaleString()}
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  Products analyzed today
                </Typography>
              </Stack>
            </MetricCard>

            <MetricCard>
              <Stack spacing={2}>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <NotificationsActiveIcon sx={{ color: '#FF5722', fontSize: 32 }} />
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    Counterfeits Detected
                  </Typography>
                </Stack>
                <Typography variant="h3" sx={{ color: '#FFFFFF', fontWeight: 700 }}>
                  {liveMetrics.counterfeitsDetected.toLocaleString()}
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  Flagged for review
                </Typography>
              </Stack>
            </MetricCard>

            <MetricCard>
              <Stack spacing={2}>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <TrendingUpIcon sx={{ color: '#4CAF50', fontSize: 32 }} />
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    Accuracy Rate
                  </Typography>
                </Stack>
                <Typography variant="h3" sx={{ color: '#FFFFFF', fontWeight: 700 }}>
                  {liveMetrics.accuracyRate}%
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  AI model performance
                </Typography>
              </Stack>
            </MetricCard>

            <MetricCard>
              <Stack spacing={2}>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <DashboardIcon sx={{ color: '#2196F3', fontSize: 32 }} />
                  <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600 }}>
                    Active Agents
                  </Typography>
                </Stack>
                <Typography variant="h3" sx={{ color: '#FFFFFF', fontWeight: 700 }}>
                  {liveMetrics.activeAgents}
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                  AI agents online
                </Typography>
              </Stack>
            </MetricCard>
          </Stack>

          {/* Charts Section */}
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4}>
            <MetricCard sx={{ flex: 2 }}>
              <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600, mb: 3 }}>
                Detection Trends
              </Typography>
              <Box sx={{ height: 300, width: '100%' }}>
                <ResponsiveContainer>
                  <AreaChart data={detectionData}>
                    <XAxis dataKey="name" stroke="#FFD700" />
                    <YAxis stroke="#FFD700" />
                    <Area
                      type="monotone"
                      dataKey="detections"
                      stroke="#FFD700"
                      fill="rgba(255, 215, 0, 0.2)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="verified"
                      stroke="#4CAF50"
                      fill="rgba(76, 175, 80, 0.1)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
            </MetricCard>

            <MetricCard sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600, mb: 3 }}>
                Real-time Activity
              </Typography>
              <Box sx={{ height: 300, width: '100%' }}>
                <ResponsiveContainer>
                  <LineChart data={realtimeData}>
                    <XAxis dataKey="time" stroke="#FFD700" />
                    <YAxis stroke="#FFD700" />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#FFA500"
                      strokeWidth={3}
                      dot={{ fill: '#FFD700', strokeWidth: 2, r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </MetricCard>
          </Stack>

          {/* Recent Activity */}
          <MetricCard>
            <Typography variant="h6" sx={{ color: '#FFD700', fontWeight: 600, mb: 3 }}>
              Recent Activity
            </Typography>
            {isLoading ? (
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                Loading real-time data...
              </Typography>
            ) : (
              <Stack spacing={2}>
                {recentActivity.slice(0, 3).map((activity) => (
                  <Box
                    key={activity.id}
                    sx={{
                      p: 2,
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 215, 0, 0.1)',
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={2}>
                      <Avatar
                        sx={{
                          width: 40,
                          height: 40,
                          backgroundColor: getRiskColor(activity.status === 'verified' ? 'Verified' : 
                                                      activity.confidence > 90 ? 'High Risk' : 'Medium Risk'),
                          fontSize: '0.875rem',
                          fontWeight: 600,
                        }}
                      >
                        {activity.confidence}%
                      </Avatar>
                      <Stack flex={1}>
                        <Typography variant="subtitle1" sx={{ color: '#FFFFFF', fontWeight: 600 }}>
                          {activity.productName}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                          {new Date(activity.timestamp).toLocaleString()}
                        </Typography>
                      </Stack>
                      <Chip
                        label={activity.status.toUpperCase()}
                        sx={{
                          backgroundColor: getRiskColor(activity.status === 'verified' ? 'Verified' : 
                                                      activity.confidence > 90 ? 'High Risk' : 'Medium Risk'),
                          color: '#FFFFFF',
                          fontWeight: 600,
                        }}
                      />
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </MetricCard>

          {/* CTA */}
          <Stack alignItems="center" spacing={3}>
            <Typography
              variant="h5"
              sx={{ color: '#FFD700', fontWeight: 600, textAlign: 'center' }}
            >
              Ready to protect your brand?
            </Typography>
            <PremiumButton
              size="large"
              onClick={() => {
                window.open('https://verichain-x-hedera.vercel.app/admin', '_blank');
              }}
            >
              Access Full Dashboard
            </PremiumButton>
          </Stack>
        </Stack>
      </Container>
    </AdminContainer>
  );
};