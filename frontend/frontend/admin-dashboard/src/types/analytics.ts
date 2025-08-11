/**
 * Analytics and metrics types for the admin dashboard.
 * 
 * This module defines types for system metrics, performance analytics,
 * and dashboard visualizations.
 */

export interface TimeRange {
  start: Date;
  end: Date;
  preset?: 'hour' | 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
}

export interface MetricValue {
  value: number;
  change_percent?: number;
  trend: 'up' | 'down' | 'stable';
  format: 'number' | 'percentage' | 'currency' | 'duration';
}

export interface SystemStatus {
  overall_health: 'healthy' | 'warning' | 'critical';
  uptime_seconds: number;
  last_updated: string;
  
  components: {
    api_server: 'healthy' | 'warning' | 'critical';
    database: 'healthy' | 'warning' | 'critical';
    message_queue: 'healthy' | 'warning' | 'critical';
    agents: 'healthy' | 'warning' | 'critical';
    storage: 'healthy' | 'warning' | 'critical';
  };
  
  resource_usage: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    network_mbps: number;
  };
  
  active_connections: number;
  queue_sizes: {
    analysis_queue: number;
    enforcement_queue: number;
    notification_queue: number;
  };
}

export interface MetricsSummary {
  time_range: TimeRange;
  
  // Product metrics
  products: {
    total: MetricValue;
    flagged_today: MetricValue;
    detection_rate: MetricValue;
    false_positive_rate: MetricValue;
    avg_processing_time: MetricValue;
  };
  
  // Agent metrics
  agents: {
    total_agents: MetricValue;
    active_agents: MetricValue;
    throughput_per_hour: MetricValue;
    error_rate: MetricValue;
    avg_response_time: MetricValue;
  };
  
  // Enforcement metrics
  enforcement: {
    total_actions: MetricValue;
    takedowns: MetricValue;
    warnings: MetricValue;
    appeals: MetricValue;
    appeal_success_rate: MetricValue;
  };
  
  // Supplier metrics
  suppliers: {
    total_suppliers: MetricValue;
    flagged_suppliers: MetricValue;
    repeat_offenders: MetricValue;
    avg_reputation_score: MetricValue;
  };
}

export interface DetectionMetrics {
  time_range: TimeRange;
  
  // Detection performance
  total_products_analyzed: number;
  total_products_flagged: number;
  detection_rate_percent: number;
  false_positive_rate_percent: number;
  false_negative_rate_percent: number;
  
  // Score distribution
  score_distribution: {
    range: string; // e.g., "0-10", "11-20", etc.
    count: number;
    percentage: number;
  }[];
  
  // Category breakdown
  category_metrics: {
    category: string;
    total_analyzed: number;
    flagged_count: number;
    detection_rate: number;
    avg_score: number;
  }[];
  
  // Daily trend
  daily_trend: {
    date: string;
    analyzed_count: number;
    flagged_count: number;
    detection_rate: number;
    avg_score: number;
  }[];
  
  // Performance metrics
  processing_metrics: {
    avg_processing_time_ms: number;
    min_processing_time_ms: number;
    max_processing_time_ms: number;
    p95_processing_time_ms: number;
    throughput_per_hour: number;
  };
}

export interface SupplierMetrics {
  supplier_id: string;
  supplier_name: string;
  
  // Product statistics
  total_products: number;
  flagged_products: number;
  flagged_percentage: number;
  
  // Reputation
  reputation_score: number;
  reputation_trend: 'improving' | 'declining' | 'stable';
  
  // Enforcement actions
  total_enforcement_actions: number;
  enforcement_breakdown: {
    warnings: number;
    takedowns: number;
    suspensions: number;
  };
  
  // Appeals
  appeals_submitted: number;
  appeals_successful: number;
  appeal_success_rate: number;
  
  // Time series data
  monthly_flagged_trend: {
    month: string;
    flagged_count: number;
    total_products: number;
    flagged_rate: number;
  }[];
  
  // Category breakdown
  category_performance: {
    category: string;
    total_products: number;
    flagged_count: number;
    flagged_rate: number;
  }[];
}

export interface PerformanceMetrics {
  time_range: TimeRange;
  
  // System performance
  system_metrics: {
    timestamp: string;
    cpu_usage_percent: number;
    memory_usage_percent: number;
    disk_usage_percent: number;
    network_throughput_mbps: number;
    active_connections: number;
  }[];
  
  // API performance
  api_metrics: {
    endpoint: string;
    total_requests: number;
    avg_response_time_ms: number;
    p95_response_time_ms: number;
    error_rate_percent: number;
    requests_per_minute: number;
  }[];
  
  // Agent performance
  agent_metrics: {
    agent_id: string;
    agent_type: string;
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    avg_processing_time_ms: number;
    throughput_per_hour: number;
    error_rate_percent: number;
  }[];
  
  // Database performance
  database_metrics: {
    connection_pool_usage: number;
    avg_query_time_ms: number;
    slow_queries_count: number;
    deadlocks_count: number;
    cache_hit_rate_percent: number;
  };
}

export interface ComplianceReport {
  report_id: string;
  report_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  time_range: TimeRange;
  generated_at: string;
  generated_by: string;
  
  // Executive summary
  summary: {
    total_products_reviewed: number;
    counterfeit_products_detected: number;
    enforcement_actions_taken: number;
    appeals_processed: number;
    compliance_score: number;
  };
  
  // Detailed metrics
  detection_statistics: {
    true_positives: number;
    false_positives: number;
    true_negatives: number;
    false_negatives: number;
    precision: number;
    recall: number;
    f1_score: number;
  };
  
  // Enforcement effectiveness
  enforcement_statistics: {
    immediate_takedowns: number;
    gradual_enforcements: number;
    successful_appeals: number;
    enforcement_accuracy: number;
  };
  
  // Supplier compliance
  supplier_compliance: {
    compliant_suppliers: number;
    non_compliant_suppliers: number;
    repeat_violators: number;
    supplier_improvement_rate: number;
  };
  
  // Regional breakdown
  geographic_data: {
    region: string;
    products_analyzed: number;
    violation_rate: number;
    enforcement_actions: number;
  }[];
  
  // Category analysis
  category_analysis: {
    category: string;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    violation_rate: number;
    trend: 'improving' | 'declining' | 'stable';
  }[];
}

export interface ChartDataPoint {
  x: string | number | Date;
  y: number;
  label?: string;
  color?: string;
  metadata?: Record<string, any>;
}

export interface ChartSeries {
  name: string;
  data: ChartDataPoint[];
  color?: string;
  type?: 'line' | 'bar' | 'area' | 'pie' | 'scatter';
}

export interface ChartConfig {
  title: string;
  subtitle?: string;
  type: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'heatmap' | 'gauge';
  series: ChartSeries[];
  
  // Axes configuration
  xAxis?: {
    title: string;
    type: 'category' | 'numeric' | 'datetime';
    format?: string;
  };
  yAxis?: {
    title: string;
    format?: string;
    min?: number;
    max?: number;
  };
  
  // Styling
  height?: number;
  colors?: string[];
  
  // Interactivity
  clickable?: boolean;
  zoomable?: boolean;
  downloadable?: boolean;
}

export interface DashboardWidget {
  id: string;
  title: string;
  type: 'metric' | 'chart' | 'table' | 'status' | 'list';
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  // Widget configuration
  config: {
    metric?: MetricValue;
    chart?: ChartConfig;
    refresh_interval_seconds?: number;
    data_source?: string;
    filters?: Record<string, any>;
  };
  
  // Widget state
  loading?: boolean;
  error?: string;
  last_updated?: string;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  widgets: DashboardWidget[];
  layout: 'grid' | 'flex';
  
  // Access control
  created_by: string;
  shared_with: string[];
  is_public: boolean;
  
  // Metadata
  created_at: string;
  updated_at: string;
  tags: string[];
}

// Export utility functions
export const formatMetricValue = (metric: MetricValue): string => {
  switch (metric.format) {
    case 'percentage':
      return `${metric.value.toFixed(1)}%`;
    case 'currency':
      return `$${metric.value.toLocaleString()}`;
    case 'duration':
      return formatDuration(metric.value);
    case 'number':
    default:
      return metric.value.toLocaleString();
  }
};

export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

export const getTrendIcon = (trend: 'up' | 'down' | 'stable'): string => {
  switch (trend) {
    case 'up':
      return 'trending_up';
    case 'down':
      return 'trending_down';
    case 'stable':
    default:
      return 'trending_flat';
  }
};

export const getTrendColor = (trend: 'up' | 'down' | 'stable', isPositive: boolean = true): string => {
  switch (trend) {
    case 'up':
      return isPositive ? '#4caf50' : '#f44336'; // green for positive, red for negative
    case 'down':
      return isPositive ? '#f44336' : '#4caf50'; // red for positive, green for negative
    case 'stable':
    default:
      return '#757575'; // grey
  }
};

export const createTimeRange = (preset: string): TimeRange => {
  const end = new Date();
  const start = new Date();
  
  switch (preset) {
    case 'hour':
      start.setHours(end.getHours() - 1);
      break;
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case 'yesterday':
      start.setDate(end.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start.setDate(end.getDate() - 7);
      break;
    case 'month':
      start.setMonth(end.getMonth() - 1);
      break;
    case 'quarter':
      start.setMonth(end.getMonth() - 3);
      break;
    case 'year':
      start.setFullYear(end.getFullYear() - 1);
      break;
    default:
      start.setHours(0, 0, 0, 0);
  }
  
  return { start, end, preset: preset as any };
};