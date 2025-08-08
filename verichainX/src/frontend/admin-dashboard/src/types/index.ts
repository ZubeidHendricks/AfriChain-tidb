/**
 * Central type exports for the admin dashboard.
 * 
 * This module re-exports all types used throughout the dashboard
 * for convenient importing.
 */

// Product-related types
export * from './product';

// Activity and monitoring types
export * from './activity';

// Analytics and metrics types
export * from './analytics';

// Common utility types
export interface Pagination {
  page: number;
  page_size: number;
  total_count?: number;
  total_pages?: number;
  has_next?: boolean;
  has_previous?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  status: 'success' | 'error';
  timestamp: string;
}

export interface ApiError {
  message: string;
  details?: Record<string, any>;
  error_code?: string;
  timestamp: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'reviewer' | 'analyst' | 'read_only';
  permissions: string[];
  last_login: string;
  created_at: string;
  is_active: boolean;
}

export interface UserSession {
  user: User;
  token: string;
  refresh_token: string;
  expires_at: string;
}

export interface NotificationPreferences {
  email_enabled: boolean;
  push_enabled: boolean;
  sms_enabled: boolean;
  notification_types: {
    high_risk_products: boolean;
    enforcement_actions: boolean;
    system_alerts: boolean;
    appeal_updates: boolean;
    performance_alerts: boolean;
  };
}

export interface UserProfile extends User {
  avatar_url?: string;
  timezone: string;
  language: string;
  notification_preferences: NotificationPreferences;
  dashboard_preferences: {
    default_time_range: string;
    auto_refresh_enabled: boolean;
    auto_refresh_interval_seconds: number;
    compact_view: boolean;
    theme: 'light' | 'dark' | 'auto';
  };
}

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
  correlation_id?: string;
}

export interface DashboardUpdate extends WebSocketMessage {
  type: 'dashboard_update';
  data: {
    update_type: 'product_status_change' | 'agent_activity' | 'system_metrics' | 'alert';
    payload: any;
  };
}

// Filter and search types
export interface FilterOption {
  label: string;
  value: string | number;
  count?: number;
}

export interface FilterGroup {
  name: string;
  label: string;
  type: 'select' | 'multiselect' | 'range' | 'date_range' | 'search';
  options?: FilterOption[];
  value?: any;
  placeholder?: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  description?: string;
  filters: Record<string, any>;
  created_by: string;
  created_at: string;
  is_public: boolean;
  usage_count: number;
}

// Export/import types
export interface ExportRequest {
  format: 'csv' | 'json' | 'xlsx' | 'pdf';
  data_type: 'products' | 'activities' | 'analytics' | 'compliance_report';
  filters?: Record<string, any>;
  columns?: string[];
  time_range?: {
    start: Date;
    end: Date;
  };
}

export interface ExportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress_percent: number;
  download_url?: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  expires_at: string;
}

// Configuration types
export interface SystemConfiguration {
  detection_thresholds: {
    low_risk: number;
    medium_risk: number;
    high_risk: number;
    critical_risk: number;
  };
  
  enforcement_settings: {
    auto_enforcement_enabled: boolean;
    manual_review_threshold: number;
    appeal_deadline_hours: number;
  };
  
  notification_settings: {
    enabled_channels: ('email' | 'sms' | 'webhook' | 'slack')[];
    batch_notifications: boolean;
    rate_limit_per_hour: number;
  };
  
  performance_settings: {
    max_concurrent_analyses: number;
    analysis_timeout_seconds: number;
    retry_attempts: number;
    queue_size_warning_threshold: number;
  };
}

// Theme and styling types
export interface ThemeConfig {
  mode: 'light' | 'dark';
  primary_color: string;
  secondary_color: string;
  success_color: string;
  warning_color: string;
  error_color: string;
  info_color: string;
  
  typography: {
    font_family: string;
    font_size_base: number;
    line_height: number;
  };
  
  spacing: {
    unit: number; // Base spacing unit in pixels
  };
  
  breakpoints: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
}

// Common component props
export interface BaseComponentProps {
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

export interface LoadingState {
  loading: boolean;
  error?: string | null;
}

export interface AsyncState<T> extends LoadingState {
  data?: T | null;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = 
  Pick<T, Exclude<keyof T, Keys>> & 
  { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type Modify<T, R> = Omit<T, keyof R> & R;