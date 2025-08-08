/**
 * Detection metrics chart component.
 * 
 * Displays trend charts for detection performance over time.
 */

import React from 'react';
import {
  Card,
  CardHeader,
  CardContent,
  Box,
  Typography,
  useTheme,
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

import { DetectionMetrics } from '@types';

interface DetectionMetricsChartProps {
  data?: DetectionMetrics;
}

export const DetectionMetricsChart: React.FC<DetectionMetricsChartProps> = ({ data }) => {
  const theme = useTheme();

  // Transform data for chart
  const chartData = data?.daily_trend?.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    detectionRate: item.detection_rate * 100,
    flaggedCount: item.flagged_count,
    analyzedCount: item.analyzed_count,
    avgScore: item.avg_score,
  })) || [];

  if (!data || chartData.length === 0) {
    return (
      <Card>
        <CardHeader title="Detection Metrics" />
        <CardContent>
          <Box 
            display="flex" 
            justifyContent="center" 
            alignItems="center" 
            height={300}
          >
            <Typography color="text.secondary">
              No data available for the selected time period
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader 
        title="Detection Metrics Trend"
        subheader={`Last ${chartData.length} days`}
      />
      <CardContent>
        <Box height={400}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 12 }}
                tickLine={{ stroke: theme.palette.text.secondary }}
              />
              <YAxis 
                yAxisId="rate"
                orientation="left"
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                tickLine={{ stroke: theme.palette.text.secondary }}
                label={{ 
                  value: 'Detection Rate (%)', 
                  angle: -90, 
                  position: 'insideLeft',
                  style: { textAnchor: 'middle' }
                }}
              />
              <YAxis 
                yAxisId="count"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickLine={{ stroke: theme.palette.text.secondary }}
                label={{ 
                  value: 'Product Count', 
                  angle: 90, 
                  position: 'insideRight',
                  style: { textAnchor: 'middle' }
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
                formatter={(value: any, name: string) => {
                  switch (name) {
                    case 'detectionRate':
                      return [`${value.toFixed(1)}%`, 'Detection Rate'];
                    case 'flaggedCount':
                      return [value, 'Flagged Products'];
                    case 'analyzedCount':
                      return [value, 'Analyzed Products'];
                    case 'avgScore':
                      return [`${value.toFixed(1)}%`, 'Avg Authenticity Score'];
                    default:
                      return [value, name];
                  }
                }}
              />
              <Legend />
              
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="detectionRate"
                stroke={theme.palette.primary.main}
                strokeWidth={2}
                dot={{ fill: theme.palette.primary.main, strokeWidth: 2, r: 4 }}
                name="Detection Rate"
              />
              
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="flaggedCount"
                stroke={theme.palette.warning.main}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ fill: theme.palette.warning.main, strokeWidth: 2, r: 4 }}
                name="Flagged Products"
              />
              
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="avgScore"
                stroke={theme.palette.success.main}
                strokeWidth={2}
                dot={{ fill: theme.palette.success.main, strokeWidth: 2, r: 4 }}
                name="Avg Authenticity Score"
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>

        {/* Summary statistics */}
        <Box mt={2} display="flex" justifyContent="space-around" flexWrap="wrap">
          <Box textAlign="center">
            <Typography variant="h6" color="primary.main">
              {data.total_products_flagged.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total Flagged
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="h6" color="success.main">
              {data.detection_rate_percent.toFixed(1)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Detection Rate
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="h6" color="warning.main">
              {data.false_positive_rate_percent.toFixed(1)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              False Positive Rate
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="h6" color="info.main">
              {data.processing_metrics.avg_processing_time_ms.toFixed(0)}ms
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Avg Processing Time
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};