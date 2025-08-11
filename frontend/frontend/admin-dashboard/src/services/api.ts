/**
 * API service for communicating with the counterfeit detection backend.
 * 
 * This service handles all HTTP requests to the backend API,
 * including authentication, error handling, and request/response transformation.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  ProductDetails,
  ProductSummary,
  ProductPage,
  ProductFilters,
  ProductTraceability,
  ProductMetrics,
  ActivityLogEntry,
  ActivityPage,
  ActivityFilters,
  AgentInfo,
  SystemStatus,
  MetricsSummary,
  DetectionMetrics,
  SupplierMetrics,
  PerformanceMetrics,
  ComplianceReport,
  ApiResponse,
  ApiError,
  UserSession,
  UserProfile,
  ExportRequest,
  ExportJob,
  SystemConfiguration,
  Pagination,
} from '@types';

// API configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_VERSION = 'v1';

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 30000;

// Token storage keys
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

class ApiService {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE_URL}/api/${API_VERSION}`,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
    this.loadTokensFromStorage();
  }

  /**
   * Set up request and response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling and token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Handle 401 unauthorized errors
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            await this.refreshAccessToken();
            originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            this.clearTokens();
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(this.handleApiError(error));
      }
    );
  }

  /**
   * Load tokens from localStorage
   */
  private loadTokensFromStorage(): void {
    this.accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    this.refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  /**
   * Save tokens to localStorage
   */
  private saveTokensToStorage(): void {
    if (this.accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, this.accessToken);
    }
    if (this.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, this.refreshToken);
    }
  }

  /**
   * Clear tokens from memory and storage
   */
  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
      refresh_token: this.refreshToken,
    });

    const { access_token, refresh_token } = response.data;
    this.accessToken = access_token;
    if (refresh_token) {
      this.refreshToken = refresh_token;
    }
    this.saveTokensToStorage();
  }

  /**
   * Handle API errors and convert to standardized format
   */
  private handleApiError(error: any): ApiError {
    if (error.response) {
      return {
        message: error.response.data?.message || error.message,
        details: error.response.data?.details,
        error_code: error.response.data?.error_code,
        timestamp: new Date().toISOString(),
      };
    } else if (error.request) {
      return {
        message: 'Network error - please check your connection',
        timestamp: new Date().toISOString(),
      };
    } else {
      return {
        message: error.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Authentication methods
  async login(username: string, password: string): Promise<UserSession> {
    const response = await this.client.post<ApiResponse<UserSession>>('/auth/login', {
      username,
      password,
    });

    const session = response.data.data;
    this.accessToken = session.token;
    this.refreshToken = session.refresh_token;
    this.saveTokensToStorage();

    return session;
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } finally {
      this.clearTokens();
    }
  }

  async getCurrentUser(): Promise<UserProfile> {
    const response = await this.client.get<ApiResponse<UserProfile>>('/auth/me');
    return response.data.data;
  }

  // Product methods
  async getProducts(filters?: ProductFilters, pagination?: Pagination): Promise<ProductPage> {
    const params = new URLSearchParams();
    
    if (pagination) {
      params.append('page', pagination.page.toString());
      params.append('page_size', pagination.page_size.toString());
    }

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v.toString()));
          } else if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
          } else {
            params.append(key, value.toString());
          }
        }
      });
    }

    const response = await this.client.get<ApiResponse<ProductPage>>(`/products?${params}`);
    return response.data.data;
  }

  async getProduct(productId: string): Promise<ProductDetails> {
    const response = await this.client.get<ApiResponse<ProductDetails>>(`/products/${productId}`);
    return response.data.data;
  }

  async getProductTraceability(productId: string): Promise<ProductTraceability> {
    const response = await this.client.get<ApiResponse<ProductTraceability>>(`/products/${productId}/traceability`);
    return response.data.data;
  }

  async updateProductStatus(productId: string, status: string, reason?: string): Promise<void> {
    await this.client.patch(`/products/${productId}/status`, {
      status,
      reason,
    });
  }

  async getProductMetrics(timeRange?: { start: Date; end: Date }): Promise<ProductMetrics> {
    const params = new URLSearchParams();
    if (timeRange) {
      params.append('start_date', timeRange.start.toISOString());
      params.append('end_date', timeRange.end.toISOString());
    }

    const response = await this.client.get<ApiResponse<ProductMetrics>>(`/analytics/products?${params}`);
    return response.data.data;
  }

  // Activity methods
  async getActivities(filters?: ActivityFilters, pagination?: Pagination): Promise<ActivityPage> {
    const params = new URLSearchParams();
    
    if (pagination) {
      params.append('page', pagination.page.toString());
      params.append('page_size', pagination.page_size.toString());
    }

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v.toString()));
          } else if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
          } else {
            params.append(key, value.toString());
          }
        }
      });
    }

    const response = await this.client.get<ApiResponse<ActivityPage>>(`/activities?${params}`);
    return response.data.data;
  }

  async getActivity(activityId: string): Promise<ActivityLogEntry> {
    const response = await this.client.get<ApiResponse<ActivityLogEntry>>(`/activities/${activityId}`);
    return response.data.data;
  }

  // Agent methods
  async getAgents(): Promise<AgentInfo[]> {
    const response = await this.client.get<ApiResponse<AgentInfo[]>>('/agents');
    return response.data.data;
  }

  async getAgent(agentId: string): Promise<AgentInfo> {
    const response = await this.client.get<ApiResponse<AgentInfo>>(`/agents/${agentId}`);
    return response.data.data;
  }

  async restartAgent(agentId: string): Promise<void> {
    await this.client.post(`/agents/${agentId}/restart`);
  }

  async updateAgentConfiguration(agentId: string, configuration: Record<string, any>): Promise<void> {
    await this.client.patch(`/agents/${agentId}/config`, { configuration });
  }

  // System methods
  async getSystemStatus(): Promise<SystemStatus> {
    const response = await this.client.get<ApiResponse<SystemStatus>>('/system/status');
    return response.data.data;
  }

  async getMetricsSummary(timeRange?: { start: Date; end: Date }): Promise<MetricsSummary> {
    const params = new URLSearchParams();
    if (timeRange) {
      params.append('start_date', timeRange.start.toISOString());
      params.append('end_date', timeRange.end.toISOString());
    }

    const response = await this.client.get<ApiResponse<MetricsSummary>>(`/analytics/summary?${params}`);
    return response.data.data;
  }

  async getDetectionMetrics(timeRange?: { start: Date; end: Date }): Promise<DetectionMetrics> {
    const params = new URLSearchParams();
    if (timeRange) {
      params.append('start_date', timeRange.start.toISOString());
      params.append('end_date', timeRange.end.toISOString());
    }

    const response = await this.client.get<ApiResponse<DetectionMetrics>>(`/analytics/detection?${params}`);
    return response.data.data;
  }

  async getSupplierMetrics(supplierId?: string, timeRange?: { start: Date; end: Date }): Promise<SupplierMetrics[]> {
    const params = new URLSearchParams();
    if (supplierId) {
      params.append('supplier_id', supplierId);
    }
    if (timeRange) {
      params.append('start_date', timeRange.start.toISOString());
      params.append('end_date', timeRange.end.toISOString());
    }

    const response = await this.client.get<ApiResponse<SupplierMetrics[]>>(`/analytics/suppliers?${params}`);
    return response.data.data;
  }

  async getPerformanceMetrics(timeRange?: { start: Date; end: Date }): Promise<PerformanceMetrics> {
    const params = new URLSearchParams();
    if (timeRange) {
      params.append('start_date', timeRange.start.toISOString());
      params.append('end_date', timeRange.end.toISOString());
    }

    const response = await this.client.get<ApiResponse<PerformanceMetrics>>(`/analytics/performance?${params}`);
    return response.data.data;
  }

  // Compliance methods
  async generateComplianceReport(
    reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual',
    timeRange: { start: Date; end: Date }
  ): Promise<{ report_id: string }> {
    const response = await this.client.post<ApiResponse<{ report_id: string }>>('/compliance/reports', {
      report_type: reportType,
      start_date: timeRange.start.toISOString(),
      end_date: timeRange.end.toISOString(),
    });
    return response.data.data;
  }

  async getComplianceReport(reportId: string): Promise<ComplianceReport> {
    const response = await this.client.get<ApiResponse<ComplianceReport>>(`/compliance/reports/${reportId}`);
    return response.data.data;
  }

  async getComplianceReports(limit?: number): Promise<ComplianceReport[]> {
    const params = new URLSearchParams();
    if (limit) {
      params.append('limit', limit.toString());
    }

    const response = await this.client.get<ApiResponse<ComplianceReport[]>>(`/compliance/reports?${params}`);
    return response.data.data;
  }

  // Export methods
  async requestExport(exportRequest: ExportRequest): Promise<ExportJob> {
    const response = await this.client.post<ApiResponse<ExportJob>>('/exports', exportRequest);
    return response.data.data;
  }

  async getExportJob(jobId: string): Promise<ExportJob> {
    const response = await this.client.get<ApiResponse<ExportJob>>(`/exports/${jobId}`);
    return response.data.data;
  }

  async getExportJobs(limit?: number): Promise<ExportJob[]> {
    const params = new URLSearchParams();
    if (limit) {
      params.append('limit', limit.toString());
    }

    const response = await this.client.get<ApiResponse<ExportJob[]>>(`/exports?${params}`);
    return response.data.data;
  }

  async downloadExport(jobId: string): Promise<Blob> {
    const response = await this.client.get(`/exports/${jobId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  }

  // Configuration methods
  async getSystemConfiguration(): Promise<SystemConfiguration> {
    const response = await this.client.get<ApiResponse<SystemConfiguration>>('/system/config');
    return response.data.data;
  }

  async updateSystemConfiguration(configuration: Partial<SystemConfiguration>): Promise<void> {
    await this.client.patch('/system/config', configuration);
  }

  // Search methods
  async searchProducts(query: string, filters?: ProductFilters, limit?: number): Promise<ProductSummary[]> {
    const params = new URLSearchParams();
    params.append('q', query);
    if (limit) {
      params.append('limit', limit.toString());
    }

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v.toString()));
          } else if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
          } else {
            params.append(key, value.toString());
          }
        }
      });
    }

    const response = await this.client.get<ApiResponse<ProductSummary[]>>(`/search/products?${params}`);
    return response.data.data;
  }

  async searchActivities(query: string, filters?: ActivityFilters, limit?: number): Promise<ActivityLogEntry[]> {
    const params = new URLSearchParams();
    params.append('q', query);
    if (limit) {
      params.append('limit', limit.toString());
    }

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v.toString()));
          } else if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
          } else {
            params.append(key, value.toString());
          }
        }
      });
    }

    const response = await this.client.get<ApiResponse<ActivityLogEntry[]>>(`/search/activities?${params}`);
    return response.data.data;
  }

  // Utility methods
  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  // File upload method
  async uploadFile(file: File, type: 'product_image' | 'evidence' | 'document'): Promise<{ url: string; file_id: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    const response = await this.client.post<ApiResponse<{ url: string; file_id: string }>>('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data.data;
  }
}

// Create a singleton instance
export const apiService = new ApiService();

// Export the service class for testing
export { ApiService };

// Export some commonly used request configurations
export const defaultPagination: Pagination = {
  page: 1,
  page_size: 20,
};

export const largePagination: Pagination = {
  page: 1,
  page_size: 100,
};

export const smallPagination: Pagination = {
  page: 1,
  page_size: 10,
};