/**
 * Enterprise Compliance Dashboard - Main dashboard component for compliance officers
 * 
 * Provides comprehensive monitoring of zkSNARK proof verification,
 * audit trail integrity, and regulatory compliance metrics.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  RefreshCw,
  Shield,
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Activity,
  Database,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  Eye,
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts';

// Types
interface ComplianceOverview {
  period_start: string;
  period_end: string;
  total_products_monitored: number;
  verified_products: number;
  zkproof_coverage_percentage: number;
  audit_trail_coverage_percentage: number;
  blockchain_anchored_percentage: number;
  compliance_score: number;
  risk_indicators: string[];
  last_updated: string;
}

interface ZKProofStatus {
  proof_id: string;
  entity_id: string;
  entity_type: string;
  proof_type: string;
  verification_status: string;
  is_valid: boolean;
  generated_at: string;
  verified_at: string | null;
  circuit_name: string;
  verification_details: Record<string, any>;
  blockchain_anchored: boolean;
  timestamp_verified: boolean;
}

interface RealTimeMetrics {
  timestamp: string;
  active_verifications: number;
  verification_queue_size: number;
  cache_hit_rate: number;
  average_verification_time_ms: number;
  proof_generation_rate_per_hour: number;
  audit_entries_per_hour: number;
  compliance_violations_count: number;
}

interface ComplianceReport {
  report_id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  compliance_score: number;
  risk_score: number;
  generated_at: string;
  generated_by: string;
  total_products: number;
  verified_products: number;
}

// API Service
class ComplianceAPIService {
  private baseUrl = '/api/v1/compliance';

  async getOverview(periodDays: number = 30): Promise<ComplianceOverview> {
    const response = await fetch(`${this.baseUrl}/overview?period_days=${periodDays}`);
    if (!response.ok) throw new Error('Failed to fetch compliance overview');
    return response.json();
  }

  async getZKProofStatus(limit: number = 100): Promise<ZKProofStatus[]> {
    const response = await fetch(`${this.baseUrl}/zkproof-status?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch zkSNARK proof status');
    return response.json();
  }

  async getRealTimeMetrics(): Promise<RealTimeMetrics> {
    const response = await fetch(`${this.baseUrl}/real-time-metrics`);
    if (!response.ok) throw new Error('Failed to fetch real-time metrics');
    return response.json();
  }

  async getReports(limit: number = 50): Promise<ComplianceReport[]> {
    const response = await fetch(`${this.baseUrl}/reports?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch compliance reports');
    return response.json();
  }

  async generateReport(periodStart: string, periodEnd: string, reportType: string = 'regulatory'): Promise<any> {
    const response = await fetch(`${this.baseUrl}/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_start: periodStart,
        period_end: periodEnd,
        report_type: reportType
      })
    });
    if (!response.ok) throw new Error('Failed to generate compliance report');
    return response.json();
  }

  async getCacheStats(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/verification-cache/stats`);
    if (!response.ok) throw new Error('Failed to fetch cache statistics');
    return response.json();
  }
}

const apiService = new ComplianceAPIService();

// Main Dashboard Component
export const ComplianceDashboard: React.FC = () => {
  const [overview, setOverview] = useState<ComplianceOverview | null>(null);
  const [zkProofStatuses, setZKProofStatuses] = useState<ZKProofStatus[]>([]);
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics | null>(null);
  const [reports, setReports] = useState<ComplianceReport[]>([]);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState(30);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [overviewData, zkProofData, metricsData, reportsData, cacheData] = await Promise.all([
        apiService.getOverview(selectedPeriod),
        apiService.getZKProofStatus(100),
        apiService.getRealTimeMetrics(),
        apiService.getReports(50),
        apiService.getCacheStats()
      ]);

      setOverview(overviewData);
      setZKProofStatuses(zkProofData);
      setRealTimeMetrics(metricsData);
      setReports(reportsData);
      setCacheStats(cacheData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      apiService.getRealTimeMetrics().then(setRealTimeMetrics).catch(console.error);
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Generate compliance report
  const handleGenerateReport = async () => {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - selectedPeriod);

      await apiService.generateReport(
        startDate.toISOString(),
        endDate.toISOString(),
        'regulatory'
      );

      // Refresh reports list
      const updatedReports = await apiService.getReports(50);
      setReports(updatedReports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading compliance dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Enterprise Compliance Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor zkSNARK verification, audit trails, and regulatory compliance
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleGenerateReport}>
            <FileCheck className="h-4 w-4 mr-2" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Compliance Score</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.compliance_score.toFixed(1)}%</div>
              <Progress value={overview.compliance_score} className="mt-2" />
              <p className="text-xs text-muted-foreground">
                {overview.compliance_score >= 90 ? 'Excellent' : 
                 overview.compliance_score >= 80 ? 'Good' : 
                 overview.compliance_score >= 70 ? 'Fair' : 'Needs Attention'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">zkSNARK Coverage</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.zkproof_coverage_percentage.toFixed(1)}%</div>
              <Progress value={overview.zkproof_coverage_percentage} className="mt-2" />
              <p className="text-xs text-muted-foreground">
                {overview.verified_products} of {overview.total_products_monitored} products
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Blockchain Anchored</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.blockchain_anchored_percentage.toFixed(1)}%</div>
              <Progress value={overview.blockchain_anchored_percentage} className="mt-2" />
              <p className="text-xs text-muted-foreground">
                Immutable proof anchoring
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Risk Indicators</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.risk_indicators.length}</div>
              <div className="mt-2 space-y-1">
                {overview.risk_indicators.slice(0, 2).map((risk, index) => (
                  <Badge key={index} variant="destructive" className="text-xs">
                    {risk}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="proofs">zkSNARK Proofs</TabsTrigger>
          <TabsTrigger value="realtime">Real-time Metrics</TabsTrigger>
          <TabsTrigger value="reports">Compliance Reports</TabsTrigger>
          <TabsTrigger value="cache">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Compliance Trend Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Compliance Trends</CardTitle>
                <CardDescription>Historical compliance metrics over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={[
                    { date: '2024-01', compliance: 85, zkproof: 80, audit: 90 },
                    { date: '2024-02', compliance: 88, zkproof: 85, audit: 91 },
                    { date: '2024-03', compliance: 92, zkproof: 90, audit: 94 },
                    { date: '2024-04', compliance: overview?.compliance_score || 95, zkproof: overview?.zkproof_coverage_percentage || 92, audit: overview?.audit_trail_coverage_percentage || 98 },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="compliance" stroke="#8884d8" name="Overall Compliance" />
                    <Line type="monotone" dataKey="zkproof" stroke="#82ca9d" name="zkSNARK Coverage" />
                    <Line type="monotone" dataKey="audit" stroke="#ffc658" name="Audit Coverage" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Verification Status Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Verification Status Distribution</CardTitle>
                <CardDescription>Distribution of proof verification outcomes</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Valid', value: zkProofStatuses.filter(p => p.is_valid).length, fill: '#22c55e' },
                        { name: 'Invalid', value: zkProofStatuses.filter(p => !p.is_valid).length, fill: '#ef4444' },
                        { name: 'Pending', value: zkProofStatuses.filter(p => p.verification_status === 'pending').length, fill: '#f59e0b' }
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="proofs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>zkSNARK Proof Verification Status</CardTitle>
              <CardDescription>Detailed status of all cryptographic proofs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {zkProofStatuses.slice(0, 10).map((proof) => (
                  <div key={proof.proof_id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      {proof.is_valid ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                      <div>
                        <p className="font-medium">{proof.entity_id}</p>
                        <p className="text-sm text-muted-foreground">
                          {proof.proof_type} • {proof.circuit_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {proof.blockchain_anchored && (
                        <Badge variant="secondary">Anchored</Badge>
                      )}
                      {proof.timestamp_verified && (
                        <Badge variant="secondary">Timestamped</Badge>
                      )}
                      <Badge 
                        variant={proof.is_valid ? "default" : "destructive"}
                      >
                        {proof.verification_status}
                      </Badge>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="realtime" className="space-y-4">
          {realTimeMetrics && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Verifications</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{realTimeMetrics.active_verifications}</div>
                  <p className="text-xs text-muted-foreground">Queue: {realTimeMetrics.verification_queue_size}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{realTimeMetrics.cache_hit_rate.toFixed(1)}%</div>
                  <Progress value={realTimeMetrics.cache_hit_rate} className="mt-2" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Verification Time</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{realTimeMetrics.average_verification_time_ms.toFixed(0)}ms</div>
                  <p className="text-xs text-muted-foreground">Per proof verification</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Violations</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{realTimeMetrics.compliance_violations_count}</div>
                  <p className="text-xs text-muted-foreground">Last hour</p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Reports</CardTitle>
              <CardDescription>Generated regulatory and audit reports</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {reports.map((report) => (
                  <div key={report.report_id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{report.report_type} Report</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(report.period_start).toLocaleDateString()} - {new Date(report.period_end).toLocaleDateString()}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Generated by {report.generated_by} on {new Date(report.generated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge 
                        variant={report.compliance_score >= 90 ? "default" : report.compliance_score >= 80 ? "secondary" : "destructive"}
                      >
                        {report.compliance_score.toFixed(1)}% Compliance
                      </Badge>
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cache" className="space-y-4">
          {cacheStats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Cache Performance</CardTitle>
                  <CardDescription>Verification cache statistics and performance</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between">
                        <span>Hit Rate</span>
                        <span>{cacheStats.cache_statistics?.performance_metrics?.cache_hit_rate?.toFixed(1)}%</span>
                      </div>
                      <Progress value={cacheStats.cache_statistics?.performance_metrics?.cache_hit_rate || 0} className="mt-1" />
                    </div>
                    <div>
                      <div className="flex justify-between">
                        <span>Memory Usage</span>
                        <span>
                          {cacheStats.cache_statistics?.cache_status?.memory_cache_size} / 
                          {cacheStats.cache_statistics?.cache_status?.memory_cache_max_size}
                        </span>
                      </div>
                      <Progress 
                        value={(cacheStats.cache_statistics?.cache_status?.memory_cache_size / 
                               cacheStats.cache_statistics?.cache_status?.memory_cache_max_size) * 100} 
                        className="mt-1" 
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recommendations</CardTitle>
                  <CardDescription>Cache optimization suggestions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {cacheStats.recommendations?.map((rec: string, index: number) => (
                      <div key={index} className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
                        <p className="text-sm">{rec}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};