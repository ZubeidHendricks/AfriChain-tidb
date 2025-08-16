/**
 * Fraud Reporting Dashboard
 * 
 * Comprehensive fraud analytics and reporting dashboard featuring:
 * - Real-time fraud detection metrics and statistics
 * - Interactive trend analysis and visualization
 * - Product flagging and investigation tools
 * - Pattern visualization and geographic mapping
 * - Alert management and response interface
 * - Fraud score tracking and risk assessment
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  LinearProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Badge,
} from '@mui/material';
import {
  Warning as WarningIcon,
  Security as SecurityIcon,
  TrendingUp as TrendingUpIcon,
  LocationOn as LocationIcon,
  Notifications as NotificationsIcon,
  Assessment as AssessmentIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Flag as FlagIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
} from 'recharts';

// Types
interface FraudMetrics {
  totalAlerts: number;
  alertsBySeverity: Record<string, number>;
  alertsByType: Record<string, number>;
  averageResponseTime: number;
  acknowledgmentRate: number;
  falsePositiveRate: number;
  escalationRate: number;
  topProducts: Array<{ productId: string; alertCount: number }>;
  alertTrend: Array<{ timestamp: string; count: number; severity: string }>;
}

interface FraudAlert {
  id: string;
  productId: string;
  alertType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: string;
  status: 'new' | 'investigating' | 'resolved' | 'false_positive';
  assignedTo?: string;
}

interface GeographicCluster {
  clusterId: string;
  center: { latitude: number; longitude: number };
  radius: number;
  verificationCount: number;
  fraudProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface PatternDetection {
  duplicatePatterns: Array<{
    qrCodeHash: string;
    verificationCount: number;
    riskScore: number;
    timeSpread: number;
  }>;
  suspiciousPatterns: Array<{
    patternType: string;
    confidence: number;
    affectedProducts: string[];
  }>;
  anomalyPatterns: Array<{
    anomalyType: string;
    productId: string;
    deviationScore: number;
    severity: string;
  }>;
}

const FraudReportingDashboard: React.FC = () => {
  // State management
  const [activeTab, setActiveTab] = useState(0);
  const [fraudMetrics, setFraudMetrics] = useState<FraudMetrics | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<FraudAlert[]>([]);
  const [geographicClusters, setGeographicClusters] = useState<GeographicCluster[]>([]);
  const [patternDetection, setPatternDetection] = useState<PatternDetection | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<FraudAlert | null>(null);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [investigationNotes, setInvestigationNotes] = useState('');
  const [alertResponse, setAlertResponse] = useState<string>('');
  const [timeframe, setTimeframe] = useState<'hour' | 'day' | 'week'>('day');

  // Load dashboard data
  useEffect(() => {
    loadDashboardData();
    
    // Set up real-time updates
    const interval = setInterval(loadDashboardData, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [timeframe]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Simulate API calls
      const [metricsData, alertsData, clustersData, patternsData] = await Promise.all([
        fetchFraudMetrics(timeframe),
        fetchRecentAlerts(),
        fetchGeographicClusters(),
        fetchPatternDetection(),
      ]);

      setFraudMetrics(metricsData);
      setRecentAlerts(alertsData);
      setGeographicClusters(clustersData);
      setPatternDetection(patternsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAlertClick = (alert: FraudAlert) => {
    setSelectedAlert(alert);
    setInvestigationNotes('');
    setAlertResponse('');
    setAlertDialogOpen(true);
  };

  const handleAlertResponse = async () => {
    if (!selectedAlert || !alertResponse) return;

    try {
      await updateAlertStatus(selectedAlert.id, alertResponse, investigationNotes);
      
      // Update local state
      setRecentAlerts(prev => 
        prev.map(alert => 
          alert.id === selectedAlert.id 
            ? { ...alert, status: alertResponse as any }
            : alert
        )
      );
      
      setAlertDialogOpen(false);
      setSelectedAlert(null);
    } catch (error) {
      console.error('Failed to update alert:', error);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#d32f2f';
      case 'high': return '#f57c00';
      case 'medium': return '#fbc02d';
      case 'low': return '#388e3c';
      default: return '#757575';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <ErrorIcon />;
      case 'high': return <WarningIcon />;
      case 'medium': return <InfoIcon />;
      case 'low': return <CheckCircleIcon />;
      default: return <InfoIcon />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const generateMetricsCards = () => [
    {
      title: 'Total Alerts',
      value: fraudMetrics?.totalAlerts || 0,
      icon: <NotificationsIcon />,
      color: '#1976d2',
      change: '+12%',
    },
    {
      title: 'Critical Alerts',
      value: fraudMetrics?.alertsBySeverity?.critical || 0,
      icon: <ErrorIcon />,
      color: '#d32f2f',
      change: '+5%',
    },
    {
      title: 'Response Time',
      value: `${fraudMetrics?.averageResponseTime || 0}s`,
      icon: <TrendingUpIcon />,
      color: '#388e3c',
      change: '-8%',
    },
    {
      title: 'False Positive Rate',
      value: `${fraudMetrics?.falsePositiveRate || 0}%`,
      icon: <AssessmentIcon />,
      color: '#f57c00',
      change: '-2%',
    },
  ];

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          Fraud Detection Dashboard
        </Typography>
        <LinearProgress />
        <Box sx={{ mt: 2 }}>
          <Typography>Loading fraud detection data...</Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          <SecurityIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Fraud Detection Dashboard
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small">
            <InputLabel>Timeframe</InputLabel>
            <Select
              value={timeframe}
              label="Timeframe"
              onChange={(e) => setTimeframe(e.target.value as 'hour' | 'day' | 'week')}
            >
              <MenuItem value="hour">Last Hour</MenuItem>
              <MenuItem value="day">Last 24 Hours</MenuItem>
              <MenuItem value="week">Last Week</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadDashboardData}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => console.log('Download report')}
          >
            Export Report
          </Button>
        </Box>
      </Box>

      {/* Alert Banner */}
      {fraudMetrics && fraudMetrics.alertsBySeverity.critical > 0 && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6">
            Critical Fraud Alert: {fraudMetrics.alertsBySeverity.critical} critical alerts require immediate attention!
          </Typography>
        </Alert>
      )}

      {/* Metrics Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {generateMetricsCards().map((metric, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      backgroundColor: metric.color,
                      color: 'white',
                      mr: 2,
                    }}
                  >
                    {metric.icon}
                  </Box>
                  <Box>
                    <Typography variant="h4" component="div">
                      {metric.value}
                    </Typography>
                    <Typography color="text.secondary" gutterBottom>
                      {metric.title}
                    </Typography>
                  </Box>
                </Box>
                <Chip
                  label={metric.change}
                  size="small"
                  color={metric.change.startsWith('+') ? 'error' : 'success'}
                />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Tabs Navigation */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Overview" />
          <Tab label="Recent Alerts" />
          <Tab label="Pattern Analysis" />
          <Tab label="Geographic Clusters" />
          <Tab label="Trend Analysis" />
        </Tabs>
      </Box>

      {/* Tab Content */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* Alert Distribution */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Alert Distribution by Severity
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={fraudMetrics ? Object.entries(fraudMetrics.alertsBySeverity).map(([severity, count]) => ({
                        name: severity,
                        value: count,
                        fill: getSeverityColor(severity),
                      })) : []}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label
                    />
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Alert Types */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Alert Types Distribution
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={fraudMetrics ? Object.entries(fraudMetrics.alertsByType).map(([type, count]) => ({
                    type: type.replace('_', ' '),
                    count,
                  })) : []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="type" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Top Affected Products */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Most Affected Products
                </Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Product ID</TableCell>
                        <TableCell align="right">Alert Count</TableCell>
                        <TableCell align="center">Risk Level</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {fraudMetrics?.topProducts.map((product) => (
                        <TableRow key={product.productId}>
                          <TableCell>{product.productId}</TableCell>
                          <TableCell align="right">{product.alertCount}</TableCell>
                          <TableCell align="center">
                            <Chip
                              label={product.alertCount > 10 ? 'High' : product.alertCount > 5 ? 'Medium' : 'Low'}
                              color={product.alertCount > 10 ? 'error' : product.alertCount > 5 ? 'warning' : 'success'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="center">
                            <IconButton size="small" onClick={() => console.log('Flag product', product.productId)}>
                              <FlagIcon />
                            </IconButton>
                            <IconButton size="small" onClick={() => console.log('View details', product.productId)}>
                              <VisibilityIcon />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Recent Fraud Alerts
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Severity</TableCell>
                    <TableCell>Product ID</TableCell>
                    <TableCell>Alert Type</TableCell>
                    <TableCell>Message</TableCell>
                    <TableCell>Timestamp</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentAlerts.map((alert) => (
                    <TableRow key={alert.id} hover onClick={() => handleAlertClick(alert)} sx={{ cursor: 'pointer' }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          {getSeverityIcon(alert.severity)}
                          <Chip
                            label={alert.severity}
                            color={alert.severity === 'critical' ? 'error' : alert.severity === 'high' ? 'warning' : 'default'}
                            size="small"
                            sx={{ ml: 1 }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>{alert.productId}</TableCell>
                      <TableCell>{alert.alertType.replace('_', ' ')}</TableCell>
                      <TableCell>{alert.message}</TableCell>
                      <TableCell>{formatTimestamp(alert.timestamp)}</TableCell>
                      <TableCell>
                        <Chip
                          label={alert.status}
                          color={alert.status === 'resolved' ? 'success' : alert.status === 'investigating' ? 'info' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAlertClick(alert);
                          }}
                        >
                          Investigate
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {activeTab === 2 && patternDetection && (
        <Grid container spacing={3}>
          {/* Duplicate Patterns */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Duplicate QR Patterns
                </Typography>
                {patternDetection.duplicatePatterns.map((pattern, index) => (
                  <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                    <Typography variant="subtitle2">
                      QR Hash: {pattern.qrCodeHash.substring(0, 16)}...
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Verifications: {pattern.verificationCount} | Risk Score: {pattern.riskScore}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={pattern.riskScore}
                      color={pattern.riskScore > 80 ? 'error' : pattern.riskScore > 60 ? 'warning' : 'success'}
                      sx={{ mt: 1 }}
                    />
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>

          {/* Suspicious Patterns */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Suspicious Patterns
                </Typography>
                {patternDetection.suspiciousPatterns.map((pattern, index) => (
                  <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                    <Typography variant="subtitle2">
                      {pattern.patternType.replace('_', ' ')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Products Affected: {pattern.affectedProducts.length} | Confidence: {pattern.confidence}%
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={pattern.confidence}
                      color={pattern.confidence > 80 ? 'error' : pattern.confidence > 60 ? 'warning' : 'success'}
                      sx={{ mt: 1 }}
                    />
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>

          {/* Anomaly Patterns */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Anomaly Detection Results
                </Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Product ID</TableCell>
                        <TableCell>Anomaly Type</TableCell>
                        <TableCell>Deviation Score</TableCell>
                        <TableCell>Severity</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {patternDetection.anomalyPatterns.map((anomaly, index) => (
                        <TableRow key={index}>
                          <TableCell>{anomaly.productId}</TableCell>
                          <TableCell>{anomaly.anomalyType.replace('_', ' ')}</TableCell>
                          <TableCell>{anomaly.deviationScore.toFixed(2)} σ</TableCell>
                          <TableCell>
                            <Chip
                              label={anomaly.severity}
                              color={anomaly.severity === 'critical' ? 'error' : anomaly.severity === 'high' ? 'warning' : 'default'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Button size="small" variant="outlined">
                              Investigate
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 3 && (
        <Grid container spacing={3}>
          {/* Geographic Clusters */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <LocationIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Geographic Fraud Clusters
                </Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Cluster ID</TableCell>
                        <TableCell>Location</TableCell>
                        <TableCell>Radius (km)</TableCell>
                        <TableCell>Verifications</TableCell>
                        <TableCell>Fraud Probability</TableCell>
                        <TableCell>Risk Level</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {geographicClusters.map((cluster) => (
                        <TableRow key={cluster.clusterId}>
                          <TableCell>{cluster.clusterId}</TableCell>
                          <TableCell>
                            {cluster.center.latitude.toFixed(4)}, {cluster.center.longitude.toFixed(4)}
                          </TableCell>
                          <TableCell>{cluster.radius.toFixed(1)}</TableCell>
                          <TableCell>{cluster.verificationCount}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <LinearProgress
                                variant="determinate"
                                value={cluster.fraudProbability}
                                color={cluster.fraudProbability > 70 ? 'error' : cluster.fraudProbability > 40 ? 'warning' : 'success'}
                                sx={{ width: 100, mr: 1 }}
                              />
                              {cluster.fraudProbability}%
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={cluster.riskLevel}
                              color={cluster.riskLevel === 'critical' ? 'error' : cluster.riskLevel === 'high' ? 'warning' : 'default'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="center">
                            <Button size="small" variant="outlined">
                              View Map
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {activeTab === 4 && (
        <Grid container spacing={3}>
          {/* Alert Trend */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Fraud Alert Trends
                </Typography>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={fraudMetrics?.alertTrend || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(value) => new Date(value).toLocaleDateString()}
                    />
                    <YAxis />
                    <Tooltip 
                      labelFormatter={(value) => new Date(value).toLocaleString()}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="count" 
                      stroke="#8884d8" 
                      strokeWidth={2}
                      name="Alert Count"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Alert Investigation Dialog */}
      <Dialog open={alertDialogOpen} onClose={() => setAlertDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Investigate Alert: {selectedAlert?.id}
        </DialogTitle>
        <DialogContent>
          {selectedAlert && (
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2">Product ID:</Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>{selectedAlert.productId}</Typography>
                  
                  <Typography variant="subtitle2">Alert Type:</Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>{selectedAlert.alertType}</Typography>
                  
                  <Typography variant="subtitle2">Severity:</Typography>
                  <Chip 
                    label={selectedAlert.severity} 
                    color={selectedAlert.severity === 'critical' ? 'error' : 'warning'}
                    sx={{ mb: 2 }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2">Message:</Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>{selectedAlert.message}</Typography>
                  
                  <Typography variant="subtitle2">Timestamp:</Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>{formatTimestamp(selectedAlert.timestamp)}</Typography>
                  
                  <Typography variant="subtitle2">Current Status:</Typography>
                  <Chip label={selectedAlert.status} sx={{ mb: 2 }} />
                </Grid>
              </Grid>
              
              <FormControl fullWidth sx={{ mt: 2, mb: 2 }}>
                <InputLabel>Response Action</InputLabel>
                <Select
                  value={alertResponse}
                  label="Response Action"
                  onChange={(e) => setAlertResponse(e.target.value)}
                >
                  <MenuItem value="investigating">Start Investigation</MenuItem>
                  <MenuItem value="false_positive">Mark as False Positive</MenuItem>
                  <MenuItem value="resolved">Mark as Resolved</MenuItem>
                </Select>
              </FormControl>
              
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Investigation Notes"
                value={investigationNotes}
                onChange={(e) => setInvestigationNotes(e.target.value)}
                sx={{ mt: 2 }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAlertDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAlertResponse} variant="contained" disabled={!alertResponse}>
            Update Alert
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

// Mock API functions
const fetchFraudMetrics = async (timeframe: string): Promise<FraudMetrics> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    totalAlerts: 89,
    alertsBySeverity: {
      critical: 12,
      high: 23,
      medium: 34,
      low: 20,
    },
    alertsByType: {
      real_time: 45,
      pattern_detected: 28,
      threshold_exceeded: 16,
    },
    averageResponseTime: 324,
    acknowledgmentRate: 94.4,
    falsePositiveRate: 3.2,
    escalationRate: 8.9,
    topProducts: [
      { productId: 'PROD-001', alertCount: 15 },
      { productId: 'PROD-002', alertCount: 12 },
      { productId: 'PROD-003', alertCount: 8 },
      { productId: 'PROD-004', alertCount: 6 },
      { productId: 'PROD-005', alertCount: 4 },
    ],
    alertTrend: Array.from({length: 24}, (_, i) => ({
      timestamp: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      count: Math.floor(Math.random() * 10) + 1,
      severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
    })),
  };
};

const fetchRecentAlerts = async (): Promise<FraudAlert[]> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  
  return Array.from({length: 15}, (_, i) => ({
    id: `alert-${i + 1}`,
    productId: `PROD-${String(i + 1).padStart(3, '0')}`,
    alertType: ['real_time', 'pattern_detected', 'threshold_exceeded'][Math.floor(Math.random() * 3)],
    severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)] as any,
    message: `Suspicious verification pattern detected for product PROD-${String(i + 1).padStart(3, '0')}`,
    timestamp: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString(),
    status: ['new', 'investigating', 'resolved', 'false_positive'][Math.floor(Math.random() * 4)] as any,
  }));
};

const fetchGeographicClusters = async (): Promise<GeographicCluster[]> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  
  return Array.from({length: 8}, (_, i) => ({
    clusterId: `cluster-${i + 1}`,
    center: {
      latitude: 6.5244 + (Math.random() - 0.5) * 0.5,
      longitude: 3.3792 + (Math.random() - 0.5) * 0.5,
    },
    radius: Math.random() * 20 + 5,
    verificationCount: Math.floor(Math.random() * 100) + 20,
    fraudProbability: Math.floor(Math.random() * 100),
    riskLevel: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)] as any,
  }));
};

const fetchPatternDetection = async (): Promise<PatternDetection> => {
  await new Promise(resolve => setTimeout(resolve, 700));
  
  return {
    duplicatePatterns: Array.from({length: 5}, (_, i) => ({
      qrCodeHash: `hash${i}${'a'.repeat(32)}`,
      verificationCount: Math.floor(Math.random() * 50) + 10,
      riskScore: Math.floor(Math.random() * 100),
      timeSpread: Math.random() * 24,
    })),
    suspiciousPatterns: Array.from({length: 3}, (_, i) => ({
      patternType: ['bulk_verification', 'coordinated_attack', 'bot_activity'][i],
      confidence: Math.floor(Math.random() * 100),
      affectedProducts: [`PROD-${i + 1}01`, `PROD-${i + 1}02`, `PROD-${i + 1}03`],
    })),
    anomalyPatterns: Array.from({length: 4}, (_, i) => ({
      anomalyType: ['volume_spike', 'velocity_anomaly', 'behavior_deviation', 'temporal_anomaly'][i],
      productId: `PROD-${String(i + 1).padStart(3, '0')}`,
      deviationScore: Math.random() * 5 + 2,
      severity: ['medium', 'high', 'critical'][Math.floor(Math.random() * 3)],
    })),
  };
};

const updateAlertStatus = async (alertId: string, status: string, notes: string): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('Updating alert:', { alertId, status, notes });
};

export default FraudReportingDashboard;