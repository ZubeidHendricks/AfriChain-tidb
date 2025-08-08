/**
 * Activity and agent monitoring types for the admin dashboard.
 * 
 * This module defines types for tracking agent activities, system events,
 * and monitoring the overall system performance.
 */

export enum ActivityType {
  PRODUCT_ANALYSIS = 'product_analysis',
  RULE_EVALUATION = 'rule_evaluation',
  ENFORCEMENT_ACTION = 'enforcement_action',
  NOTIFICATION_SENT = 'notification_sent',
  APPEAL_SUBMITTED = 'appeal_submitted',
  APPEAL_REVIEWED = 'appeal_reviewed',
  MANUAL_OVERRIDE = 'manual_override',
  SYSTEM_EVENT = 'system_event',
  USER_ACTION = 'user_action',
  DATA_INGESTION = 'data_ingestion',
  ERROR_EVENT = 'error_event',
}

export enum ActivityStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRY = 'retry',
}

export enum AgentType {
  AUTHENTICITY_AGENT = 'authenticity_agent',
  RULE_ENGINE_AGENT = 'rule_engine_agent',
  ENFORCEMENT_AGENT = 'enforcement_agent',
  NOTIFICATION_AGENT = 'notification_agent',
  INGESTION_AGENT = 'ingestion_agent',
  MONITORING_AGENT = 'monitoring_agent',
}

export enum AgentStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}

export interface ActivityLogEntry {
  id: string;
  activity_type: ActivityType;
  status: ActivityStatus;
  
  // Related entities
  product_id?: string;
  product_title?: string;
  supplier_id?: string;
  supplier_name?: string;
  user_id?: string;
  
  // Agent information
  agent_id: string;
  agent_type: AgentType;
  agent_name: string;
  
  // Activity details
  title: string;
  description: string;
  details: Record<string, any>;
  
  // Timing information
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  
  // Results and metadata
  result?: Record<string, any>;
  error_message?: string;
  retry_count?: number;
  
  // Context
  context: {
    source?: string;
    triggered_by?: string;
    correlation_id?: string;
    session_id?: string;
    [key: string]: any;
  };
  
  // Metrics
  processing_time_ms?: number;
  memory_usage_mb?: number;
  cpu_usage_percent?: number;
}

export interface ActivityFilters {
  activity_types?: ActivityType[];
  status?: ActivityStatus[];
  agent_types?: AgentType[];
  agent_ids?: string[];
  product_ids?: string[];
  supplier_ids?: string[];
  user_ids?: string[];
  
  // Time filtering
  time_range?: {
    start: Date;
    end: Date;
    preset?: 'last_hour' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';
  };
  
  // Content filtering
  search_query?: string;
  has_errors?: boolean;
  min_duration_ms?: number;
  max_duration_ms?: number;
  
  // Correlation
  correlation_id?: string;
  session_id?: string;
}

export interface ActivityPage {
  activities: ActivityLogEntry[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface ProductActivityGroup {
  product_id: string;
  product_title: string;
  supplier_name: string;
  activity_count: number;
  latest_activity: string;
  activities: ActivityLogEntry[];
  summary: {
    analyses: number;
    enforcements: number;
    notifications: number;
    errors: number;
  };
}

export interface AgentInfo {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  version: string;
  
  // Configuration
  capabilities: string[];
  configuration: Record<string, any>;
  
  // Status information
  last_heartbeat: string;
  uptime_seconds: number;
  
  // Performance metrics
  metrics: {
    total_tasks_processed: number;
    tasks_per_minute: number;
    average_processing_time_ms: number;
    error_rate_percent: number;
    success_rate_percent: number;
    queue_size: number;
    memory_usage_mb: number;
    cpu_usage_percent: number;
  };
  
  // Recent activity
  recent_activities: ActivityLogEntry[];
  
  // Health status
  health_checks: {
    name: string;
    status: 'healthy' | 'warning' | 'critical';
    message: string;
    last_checked: string;
  }[];
}

export interface SystemEvent {
  id: string;
  event_type: 'startup' | 'shutdown' | 'error' | 'warning' | 'info' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  // Event details
  title: string;
  message: string;
  details: Record<string, any>;
  
  // Source information
  source: string;
  component: string;
  
  // Timing
  timestamp: string;
  
  // Resolution
  resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
}

export interface ActivityMetrics {
  // Overall activity stats
  total_activities: number;
  activities_per_hour: number;
  activities_by_type: Record<ActivityType, number>;
  activities_by_status: Record<ActivityStatus, number>;
  
  // Agent performance
  agents_summary: {
    total_agents: number;
    active_agents: number;
    busy_agents: number;
    error_agents: number;
    offline_agents: number;
  };
  
  // Processing metrics
  average_processing_time_ms: number;
  throughput_per_minute: number;
  error_rate_percent: number;
  success_rate_percent: number;
  
  // Trend data
  activity_trend: {
    timestamp: string;
    activity_count: number;
    error_count: number;
    average_duration_ms: number;
  }[];
  
  // Performance trends
  performance_trend: {
    timestamp: string;
    throughput: number;
    response_time_ms: number;
    error_rate: number;
  }[];
}

export interface ActivitySearchResult {
  activities: ActivityLogEntry[];
  total_matches: number;
  search_time_ms: number;
  suggestions: string[];
  facets: {
    activity_types: { type: ActivityType; count: number }[];
    agents: { agent_id: string; agent_name: string; count: number }[];
    time_periods: { period: string; count: number }[];
  };
}

// Real-time activity update
export interface ActivityUpdate {
  type: 'activity_created' | 'activity_updated' | 'activity_completed' | 'activity_failed';
  activity: ActivityLogEntry;
  timestamp: string;
}

// Agent status update
export interface AgentStatusUpdate {
  type: 'agent_status_changed' | 'agent_metrics_updated' | 'agent_health_check';
  agent_id: string;
  agent_info: Partial<AgentInfo>;
  timestamp: string;
}

// System event update
export interface SystemEventUpdate {
  type: 'system_event' | 'event_resolved';
  event: SystemEvent;
  timestamp: string;
}

// Export utility functions
export const getActivityTypeIcon = (type: ActivityType): string => {
  switch (type) {
    case ActivityType.PRODUCT_ANALYSIS:
      return 'analytics';
    case ActivityType.RULE_EVALUATION:
      return 'rule';
    case ActivityType.ENFORCEMENT_ACTION:
      return 'gavel';
    case ActivityType.NOTIFICATION_SENT:
      return 'notifications';
    case ActivityType.APPEAL_SUBMITTED:
      return 'appeal';
    case ActivityType.APPEAL_REVIEWED:
      return 'verified';
    case ActivityType.MANUAL_OVERRIDE:
      return 'admin_panel_settings';
    case ActivityType.SYSTEM_EVENT:
      return 'computer';
    case ActivityType.USER_ACTION:
      return 'person';
    case ActivityType.DATA_INGESTION:
      return 'cloud_upload';
    case ActivityType.ERROR_EVENT:
      return 'error';
    default:
      return 'help';
  }
};

export const getActivityTypeColor = (type: ActivityType): string => {
  switch (type) {
    case ActivityType.PRODUCT_ANALYSIS:
      return '#2196f3'; // blue
    case ActivityType.RULE_EVALUATION:
      return '#ff9800'; // orange
    case ActivityType.ENFORCEMENT_ACTION:
      return '#f44336'; // red
    case ActivityType.NOTIFICATION_SENT:
      return '#4caf50'; // green
    case ActivityType.APPEAL_SUBMITTED:
      return '#9c27b0'; // purple
    case ActivityType.APPEAL_REVIEWED:
      return '#00bcd4'; // cyan
    case ActivityType.MANUAL_OVERRIDE:
      return '#ff5722'; // deep orange
    case ActivityType.SYSTEM_EVENT:
      return '#607d8b'; // blue grey
    case ActivityType.USER_ACTION:
      return '#795548'; // brown
    case ActivityType.DATA_INGESTION:
      return '#8bc34a'; // light green
    case ActivityType.ERROR_EVENT:
      return '#e91e63'; // pink
    default:
      return '#757575'; // grey
  }
};

export const getStatusColor = (status: ActivityStatus): string => {
  switch (status) {
    case ActivityStatus.PENDING:
      return '#ff9800'; // orange
    case ActivityStatus.IN_PROGRESS:
      return '#2196f3'; // blue
    case ActivityStatus.COMPLETED:
      return '#4caf50'; // green
    case ActivityStatus.FAILED:
      return '#f44336'; // red
    case ActivityStatus.CANCELLED:
      return '#757575'; // grey
    case ActivityStatus.RETRY:
      return '#ff5722'; // deep orange
    default:
      return '#757575'; // grey
  }
};

export const getAgentStatusColor = (status: AgentStatus): string => {
  switch (status) {
    case AgentStatus.ACTIVE:
      return '#4caf50'; // green
    case AgentStatus.IDLE:
      return '#8bc34a'; // light green
    case AgentStatus.BUSY:
      return '#ff9800'; // orange
    case AgentStatus.ERROR:
      return '#f44336'; // red
    case AgentStatus.OFFLINE:
      return '#757575'; // grey
    case AgentStatus.MAINTENANCE:
      return '#9c27b0'; // purple
    default:
      return '#757575'; // grey
  }
};

export const formatDuration = (durationMs: number): string => {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  } else if (durationMs < 3600000) {
    return `${(durationMs / 60000).toFixed(1)}m`;
  } else {
    return `${(durationMs / 3600000).toFixed(1)}h`;
  }
};