import { QrCodeModel } from '../models/QrCode';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';

/**
 * Analytics Configuration
 */
export interface AnalyticsConfig {
  enableRealTimeTracking: boolean;
  enableGeoLocationTracking: boolean;
  enableDeviceFingerprinting: boolean;
  enablePerformanceMetrics: boolean;
  dataRetentionDays: number;
  aggregationInterval: number; // minutes
  alertThresholds: {
    suspiciousActivity: number;
    massScanning: number;
    failureRate: number; // percentage
  };
  privacyMode: 'strict' | 'balanced' | 'permissive';
}

/**
 * Analytics Event
 */
export interface AnalyticsEvent {
  eventId: string;
  eventType: 'scan' | 'verification' | 'failure' | 'suspicious';
  qrCodeId: string;
  timestamp: Date;
  context: {
    scanId: string;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
    location?: {
      country?: string;
      region?: string;
      city?: string;
      coordinates?: { lat: number; lng: number };
    };
    performance?: {
      verificationTime: number;
      networkLatency?: number;
      renderTime?: number;
    };
    referrer?: string;
    sessionId?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Real-time Analytics Data
 */
export interface RealTimeMetrics {
  timestamp: Date;
  activeScans: number;
  scansPerMinute: number;
  successRate: number;
  averageVerificationTime: number;
  topCountries: Array<{ country: string; count: number }>;
  topDevices: Array<{ device: string; count: number }>;
  alertsTriggered: number;
  performanceScore: number;
}

/**
 * Historical Analytics Report
 */
export interface AnalyticsReport {
  period: { startDate: Date; endDate: Date };
  summary: {
    totalScans: number;
    uniqueUsers: number;
    successfulScans: number;
    failedScans: number;
    averageScansPerUser: number;
    peakScanTime: string;
    geographicalReach: number; // number of countries
    deviceDiversity: number; // number of unique device types
  };
  trends: {
    scanVelocity: Array<{ date: string; scans: number }>;
    successRateOverTime: Array<{ date: string; rate: number }>;
    performanceMetrics: Array<{ date: string; avgTime: number }>;
  };
  insights: {
    popularQrCodes: Array<{ qrCodeId: string; scans: number; type: string }>;
    geographicalDistribution: Array<{ country: string; scans: number; percentage: number }>;
    deviceAnalysis: Array<{ deviceType: string; scans: number; successRate: number }>;
    timePatterns: Array<{ hour: number; scans: number; avgSuccessRate: number }>;
    campaignPerformance?: Array<{ source: string; scans: number; conversionRate: number }>;
  };
  anomalies: Array<{
    type: 'suspicious_activity' | 'mass_scanning' | 'failure_spike' | 'geographic_anomaly';
    description: string;
    severity: 'low' | 'medium' | 'high';
    detectedAt: Date;
    affectedQrCodes: string[];
    recommendedActions: string[];
  }>;
  recommendations: Array<{
    category: 'performance' | 'security' | 'user_experience' | 'business';
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    estimatedImpact: string;
  }>;
}

/**
 * QR Code Heatmap Data
 */
export interface QrCodeHeatmap {
  qrCodeId: string;
  totalScans: number;
  heatmapData: Array<{
    coordinates: { lat: number; lng: number };
    intensity: number;
    scanCount: number;
    lastScanTime: Date;
  }>;
  scanDensity: {
    high: Array<{ region: string; density: number }>;
    medium: Array<{ region: string; density: number }>;
    low: Array<{ region: string; density: number }>;
  };
}

/**
 * Performance Metrics
 */
export interface PerformanceMetrics {
  qrCodeId: string;
  period: { startDate: Date; endDate: Date };
  metrics: {
    averageVerificationTime: number;
    p95VerificationTime: number;
    p99VerificationTime: number;
    errorRate: number;
    timeoutRate: number;
    cacheHitRate?: number;
  };
  breakdown: {
    byDevice: Array<{ deviceType: string; avgTime: number; errorRate: number }>;
    byLocation: Array<{ country: string; avgTime: number; reliability: number }>;
    byTimeOfDay: Array<{ hour: number; avgTime: number; volume: number }>;
  };
  trends: Array<{
    timestamp: Date;
    verificationTime: number;
    success: boolean;
    errorType?: string;
  }>;
}

/**
 * QR Code Analytics Service
 * Comprehensive analytics and tracking for QR code usage
 */
export class QrCodeAnalyticsService extends EventEmitter {
  private config: AnalyticsConfig;
  private qrCodeModel: QrCodeModel;
  private realTimeMetrics: Map<string, RealTimeMetrics> = new Map();
  private eventBuffer: AnalyticsEvent[] = [];
  private aggregationInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor(config: Partial<AnalyticsConfig> = {}) {
    super();

    this.config = {
      enableRealTimeTracking: process.env.QR_ANALYTICS_REALTIME !== 'false',
      enableGeoLocationTracking: process.env.QR_ANALYTICS_GEOLOCATION !== 'false',
      enableDeviceFingerprinting: process.env.QR_ANALYTICS_FINGERPRINTING !== 'false',
      enablePerformanceMetrics: process.env.QR_ANALYTICS_PERFORMANCE !== 'false',
      dataRetentionDays: parseInt(process.env.QR_ANALYTICS_RETENTION_DAYS || '90'),
      aggregationInterval: parseInt(process.env.QR_ANALYTICS_INTERVAL || '5'),
      alertThresholds: {
        suspiciousActivity: parseInt(process.env.QR_ALERT_SUSPICIOUS || '100'),
        massScanning: parseInt(process.env.QR_ALERT_MASS_SCAN || '1000'),
        failureRate: parseInt(process.env.QR_ALERT_FAILURE_RATE || '25')
      },
      privacyMode: (process.env.QR_ANALYTICS_PRIVACY_MODE as any) || 'balanced',
      ...config
    };

    this.qrCodeModel = new QrCodeModel();

    // Start real-time processing if enabled
    if (this.config.enableRealTimeTracking) {
      this.startRealTimeProcessing();
    }

    console.log('📊 QR Code Analytics Service initialized');
  }

  /**
   * Track QR code scan event
   */
  async trackScanEvent(event: Omit<AnalyticsEvent, 'eventId' | 'timestamp'>): Promise<void> {
    try {
      const analyticsEvent: AnalyticsEvent = {
        ...event,
        eventId: this.generateEventId(),
        timestamp: new Date()
      };

      // Apply privacy filtering
      const filteredEvent = this.applyPrivacyFilters(analyticsEvent);

      // Add to event buffer for processing
      this.eventBuffer.push(filteredEvent);

      // Emit real-time event
      this.emit('scan_tracked', filteredEvent);

      // Update real-time metrics
      if (this.config.enableRealTimeTracking) {
        await this.updateRealTimeMetrics(filteredEvent);
      }

      // Check for anomalies
      await this.detectAnomalies(filteredEvent);

      console.log(`📊 Scan event tracked: ${event.qrCodeId}`);

    } catch (error) {
      console.error('❌ Failed to track scan event:', error);
      this.emit('tracking_error', { error, event });
    }
  }

  /**
   * Generate comprehensive analytics report
   */
  async generateAnalyticsReport(
    qrCodeIds: string[],
    period: { startDate: Date; endDate: Date },
    options: {
      includeHeatmap?: boolean;
      includePerformance?: boolean;
      includeAnomalies?: boolean;
      includeRecommendations?: boolean;
    } = {}
  ): Promise<AnalyticsReport> {
    try {
      console.log(`📊 Generating analytics report for ${qrCodeIds.length} QR codes`);

      const {
        includeHeatmap = true,
        includePerformance = true,
        includeAnomalies = true,
        includeRecommendations = true
      } = options;

      // Get summary data
      const summary = await this.generateSummary(qrCodeIds, period);

      // Get trend data
      const trends = await this.generateTrends(qrCodeIds, period);

      // Get insights
      const insights = await this.generateInsights(qrCodeIds, period);

      // Get anomalies if requested
      const anomalies = includeAnomalies 
        ? await this.detectPeriodAnomalies(qrCodeIds, period)
        : [];

      // Generate recommendations if requested
      const recommendations = includeRecommendations
        ? await this.generateRecommendations(summary, trends, insights, anomalies)
        : [];

      const report: AnalyticsReport = {
        period,
        summary,
        trends,
        insights,
        anomalies,
        recommendations
      };

      console.log(`✅ Analytics report generated successfully`);
      this.emit('report_generated', { report, qrCodeIds, period });

      return report;

    } catch (error) {
      console.error('❌ Failed to generate analytics report:', error);
      throw error;
    }
  }

  /**
   * Get real-time metrics
   */
  getRealTimeMetrics(qrCodeId?: string): RealTimeMetrics | Map<string, RealTimeMetrics> {
    if (qrCodeId) {
      return this.realTimeMetrics.get(qrCodeId) || this.createEmptyMetrics();
    }
    return this.realTimeMetrics;
  }

  /**
   * Generate QR code heatmap
   */
  async generateHeatmap(qrCodeId: string, period?: { startDate: Date; endDate: Date }): Promise<QrCodeHeatmap> {
    try {
      console.log(`🗺️ Generating heatmap for QR code: ${qrCodeId}`);

      // Get scan data with location information
      const analytics = await this.qrCodeModel.getScanAnalytics(qrCodeId, period);

      // Process location data to create heatmap points
      const heatmapData = await this.processLocationDataForHeatmap(analytics.recentScans);

      // Calculate scan density by region
      const scanDensity = this.calculateScanDensity(heatmapData);

      const heatmap: QrCodeHeatmap = {
        qrCodeId,
        totalScans: analytics.totalScans,
        heatmapData,
        scanDensity
      };

      console.log(`✅ Heatmap generated for QR code: ${qrCodeId}`);
      return heatmap;

    } catch (error) {
      console.error(`❌ Failed to generate heatmap for QR code ${qrCodeId}:`, error);
      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(
    qrCodeId: string,
    period: { startDate: Date; endDate: Date }
  ): Promise<PerformanceMetrics> {
    try {
      console.log(`⚡ Getting performance metrics for QR code: ${qrCodeId}`);

      // Get scan data for performance analysis
      const analytics = await this.qrCodeModel.getScanAnalytics(qrCodeId, period);

      // Calculate performance metrics
      const verificationTimes = analytics.recentScans
        .filter(scan => scan.isSuccessful)
        .map(scan => scan.verificationTime);

      const errorCount = analytics.recentScans.filter(scan => !scan.isSuccessful).length;

      const metrics: PerformanceMetrics = {
        qrCodeId,
        period,
        metrics: {
          averageVerificationTime: this.calculateAverage(verificationTimes),
          p95VerificationTime: this.calculatePercentile(verificationTimes, 95),
          p99VerificationTime: this.calculatePercentile(verificationTimes, 99),
          errorRate: (errorCount / analytics.totalScans) * 100,
          timeoutRate: 0 // Would need additional tracking
        },
        breakdown: {
          byDevice: this.analyzePerformanceByDevice(analytics.recentScans),
          byLocation: this.analyzePerformanceByLocation(analytics.recentScans),
          byTimeOfDay: this.analyzePerformanceByTimeOfDay(analytics.recentScans)
        },
        trends: this.generatePerformanceTrends(analytics.recentScans)
      };

      console.log(`✅ Performance metrics generated for QR code: ${qrCodeId}`);
      return metrics;

    } catch (error) {
      console.error(`❌ Failed to get performance metrics for QR code ${qrCodeId}:`, error);
      throw error;
    }
  }

  /**
   * Detect suspicious scanning patterns
   */
  async detectSuspiciousActivity(
    period: { startDate: Date; endDate: Date }
  ): Promise<Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    affectedQrCodes: string[];
    recommendations: string[];
  }>> {
    try {
      console.log('🚨 Detecting suspicious scanning activity...');

      const suspiciousActivities = [];

      // Detect rapid scanning from single IP
      const rapidScanning = await this.detectRapidScanning(period);
      if (rapidScanning.length > 0) {
        suspiciousActivities.push(...rapidScanning);
      }

      // Detect unusual geographic patterns
      const geographicAnomalies = await this.detectGeographicAnomalies(period);
      if (geographicAnomalies.length > 0) {
        suspiciousActivities.push(...geographicAnomalies);
      }

      // Detect bot-like behavior
      const botActivity = await this.detectBotActivity(period);
      if (botActivity.length > 0) {
        suspiciousActivities.push(...botActivity);
      }

      console.log(`✅ Suspicious activity detection completed: ${suspiciousActivities.length} issues found`);
      return suspiciousActivities;

    } catch (error) {
      console.error('❌ Failed to detect suspicious activity:', error);
      throw error;
    }
  }

  /**
   * Export analytics data
   */
  async exportAnalyticsData(
    qrCodeIds: string[],
    period: { startDate: Date; endDate: Date },
    format: 'json' | 'csv' | 'xlsx'
  ): Promise<{ data: any; filename: string; mimeType: string }> {
    try {
      console.log(`📤 Exporting analytics data in ${format} format`);

      // Generate comprehensive report
      const report = await this.generateAnalyticsReport(qrCodeIds, period, {
        includeHeatmap: true,
        includePerformance: true,
        includeAnomalies: true,
        includeRecommendations: true
      });

      const timestamp = new Date().toISOString().split('T')[0];
      let exportData;
      let filename;
      let mimeType;

      switch (format) {
        case 'json':
          exportData = JSON.stringify(report, null, 2);
          filename = `qr-analytics-${timestamp}.json`;
          mimeType = 'application/json';
          break;

        case 'csv':
          exportData = this.convertToCSV(report);
          filename = `qr-analytics-${timestamp}.csv`;
          mimeType = 'text/csv';
          break;

        case 'xlsx':
          exportData = await this.convertToExcel(report);
          filename = `qr-analytics-${timestamp}.xlsx`;
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          break;

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      console.log(`✅ Analytics data exported: ${filename}`);
      return { data: exportData, filename, mimeType };

    } catch (error) {
      console.error('❌ Failed to export analytics data:', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private startRealTimeProcessing(): void {
    this.aggregationInterval = setInterval(
      () => this.processEventBuffer(),
      this.config.aggregationInterval * 60 * 1000
    );

    console.log(`📊 Real-time analytics processing started (${this.config.aggregationInterval}min intervals)`);
  }

  private async processEventBuffer(): Promise<void> {
    if (this.isProcessing || this.eventBuffer.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const eventsToProcess = [...this.eventBuffer];
      this.eventBuffer = [];

      // Process events in batches
      const batchSize = 100;
      for (let i = 0; i < eventsToProcess.length; i += batchSize) {
        const batch = eventsToProcess.slice(i, i + batchSize);
        await this.processBatch(batch);
      }

      console.log(`📊 Processed ${eventsToProcess.length} analytics events`);

    } catch (error) {
      console.error('❌ Failed to process event buffer:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processBatch(events: AnalyticsEvent[]): Promise<void> {
    // Aggregate events by QR code
    const aggregated = new Map<string, AnalyticsEvent[]>();

    events.forEach(event => {
      if (!aggregated.has(event.qrCodeId)) {
        aggregated.set(event.qrCodeId, []);
      }
      aggregated.get(event.qrCodeId)!.push(event);
    });

    // Process each QR code's events
    for (const [qrCodeId, qrEvents] of aggregated) {
      await this.updateAggregatedMetrics(qrCodeId, qrEvents);
    }
  }

  private async updateAggregatedMetrics(qrCodeId: string, events: AnalyticsEvent[]): Promise<void> {
    // Update database with aggregated metrics
    // This would involve updating summary tables for faster querying
    
    // For now, emit aggregation event
    this.emit('metrics_aggregated', {
      qrCodeId,
      eventCount: events.length,
      successfulScans: events.filter(e => e.eventType === 'scan').length,
      failures: events.filter(e => e.eventType === 'failure').length,
      timestamp: new Date()
    });
  }

  private applyPrivacyFilters(event: AnalyticsEvent): AnalyticsEvent {
    const filtered = { ...event };

    switch (this.config.privacyMode) {
      case 'strict':
        // Remove all personally identifiable information
        delete filtered.context.ipAddress;
        delete filtered.context.userAgent;
        delete filtered.context.deviceFingerprint;
        if (filtered.context.location) {
          // Keep only country-level information
          delete filtered.context.location.coordinates;
          delete filtered.context.location.city;
          delete filtered.context.location.region;
        }
        break;

      case 'balanced':
        // Hash IP addresses
        if (filtered.context.ipAddress) {
          filtered.context.ipAddress = this.hashPII(filtered.context.ipAddress);
        }
        // Remove precise coordinates
        if (filtered.context.location?.coordinates) {
          delete filtered.context.location.coordinates;
        }
        break;

      case 'permissive':
        // Keep all data as-is
        break;
    }

    return filtered;
  }

  private hashPII(data: string): string {
    return createHash('sha256').update(data + process.env.ANALYTICS_SALT || 'default-salt').digest('hex').substring(0, 16);
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private async updateRealTimeMetrics(event: AnalyticsEvent): Promise<void> {
    // Update real-time metrics for the QR code
    const current = this.realTimeMetrics.get(event.qrCodeId) || this.createEmptyMetrics();
    
    current.timestamp = new Date();
    current.activeScans += 1;
    
    if (event.eventType === 'scan') {
      current.scansPerMinute += 1;
    }

    // Update success rate
    if (event.eventType === 'verification') {
      current.successRate = (current.successRate + 1) / 2; // Simple moving average
    } else if (event.eventType === 'failure') {
      current.successRate = current.successRate * 0.9; // Decay on failure
    }

    // Update performance metrics
    if (event.context.performance?.verificationTime) {
      current.averageVerificationTime = 
        (current.averageVerificationTime + event.context.performance.verificationTime) / 2;
    }

    this.realTimeMetrics.set(event.qrCodeId, current);
  }

  private createEmptyMetrics(): RealTimeMetrics {
    return {
      timestamp: new Date(),
      activeScans: 0,
      scansPerMinute: 0,
      successRate: 100,
      averageVerificationTime: 0,
      topCountries: [],
      topDevices: [],
      alertsTriggered: 0,
      performanceScore: 100
    };
  }

  private async detectAnomalies(event: AnalyticsEvent): Promise<void> {
    // Detect real-time anomalies
    const metrics = this.realTimeMetrics.get(event.qrCodeId);
    if (!metrics) return;

    // Check for mass scanning
    if (metrics.scansPerMinute > this.config.alertThresholds.massScanning) {
      this.emit('anomaly_detected', {
        type: 'mass_scanning',
        qrCodeId: event.qrCodeId,
        description: `Unusual scanning volume detected: ${metrics.scansPerMinute} scans/minute`,
        severity: 'high'
      });
    }

    // Check for suspicious activity patterns
    if (event.context.ipAddress && await this.isIpSuspicious(event.context.ipAddress)) {
      this.emit('anomaly_detected', {
        type: 'suspicious_activity',
        qrCodeId: event.qrCodeId,
        description: 'Scanning from flagged IP address',
        severity: 'medium'
      });
    }
  }

  private async isIpSuspicious(ipAddress: string): Promise<boolean> {
    // Simple implementation - in reality, this would check against threat databases
    const hashedIp = this.hashPII(ipAddress);
    // Check against internal blacklist or external threat intelligence
    return false; // Placeholder
  }

  private async generateSummary(qrCodeIds: string[], period: { startDate: Date; endDate: Date }): Promise<AnalyticsReport['summary']> {
    // Aggregate summary statistics across all QR codes
    let totalScans = 0;
    let successfulScans = 0;
    let failedScans = 0;
    let uniqueCountries = new Set<string>();

    for (const qrCodeId of qrCodeIds) {
      const analytics = await this.qrCodeModel.getScanAnalytics(qrCodeId, period);
      totalScans += analytics.totalScans;
      successfulScans += analytics.successfulScans;
      failedScans += analytics.failedScans;
      
      analytics.topCountries.forEach(country => uniqueCountries.add(country.country));
    }

    return {
      totalScans,
      uniqueUsers: 0, // Would require user tracking
      successfulScans,
      failedScans,
      averageScansPerUser: 0, // Would require user tracking
      peakScanTime: '14:00', // Would require hourly analysis
      geographicalReach: uniqueCountries.size,
      deviceDiversity: 0 // Would require device analysis
    };
  }

  private async generateTrends(qrCodeIds: string[], period: { startDate: Date; endDate: Date }): Promise<AnalyticsReport['trends']> {
    // Generate trend data - placeholder implementation
    return {
      scanVelocity: [],
      successRateOverTime: [],
      performanceMetrics: []
    };
  }

  private async generateInsights(qrCodeIds: string[], period: { startDate: Date; endDate: Date }): Promise<AnalyticsReport['insights']> {
    // Generate insights - placeholder implementation
    return {
      popularQrCodes: [],
      geographicalDistribution: [],
      deviceAnalysis: [],
      timePatterns: []
    };
  }

  private async detectPeriodAnomalies(qrCodeIds: string[], period: { startDate: Date; endDate: Date }): Promise<AnalyticsReport['anomalies']> {
    // Detect anomalies over the period - placeholder implementation
    return [];
  }

  private async generateRecommendations(
    summary: AnalyticsReport['summary'],
    trends: AnalyticsReport['trends'],
    insights: AnalyticsReport['insights'],
    anomalies: AnalyticsReport['anomalies']
  ): Promise<AnalyticsReport['recommendations']> {
    const recommendations: AnalyticsReport['recommendations'] = [];

    // Performance recommendations
    if (summary.failedScans / summary.totalScans > 0.1) {
      recommendations.push({
        category: 'performance',
        title: 'High Failure Rate Detected',
        description: 'Consider improving QR code quality or verification infrastructure',
        priority: 'high',
        estimatedImpact: 'Could improve success rate by 15-25%'
      });
    }

    // Security recommendations
    if (anomalies.some(a => a.type === 'suspicious_activity')) {
      recommendations.push({
        category: 'security',
        title: 'Suspicious Activity Detected',
        description: 'Implement additional security measures and monitoring',
        priority: 'high',
        estimatedImpact: 'Reduce security risks and false positives'
      });
    }

    return recommendations;
  }

  private async processLocationDataForHeatmap(scans: any[]): Promise<QrCodeHeatmap['heatmapData']> {
    // Process scan location data for heatmap visualization
    return scans
      .filter(scan => scan.latitude && scan.longitude)
      .map(scan => ({
        coordinates: { lat: scan.latitude, lng: scan.longitude },
        intensity: 1,
        scanCount: 1,
        lastScanTime: new Date(scan.scannedAt)
      }));
  }

  private calculateScanDensity(heatmapData: QrCodeHeatmap['heatmapData']): QrCodeHeatmap['scanDensity'] {
    // Calculate scan density by region - placeholder implementation
    return {
      high: [],
      medium: [],
      low: []
    };
  }

  private calculateAverage(numbers: number[]): number {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }

  private calculatePercentile(numbers: number[], percentile: number): number {
    if (numbers.length === 0) return 0;
    
    const sorted = numbers.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  private analyzePerformanceByDevice(scans: any[]): PerformanceMetrics['breakdown']['byDevice'] {
    // Analyze performance by device type - placeholder implementation
    return [];
  }

  private analyzePerformanceByLocation(scans: any[]): PerformanceMetrics['breakdown']['byLocation'] {
    // Analyze performance by location - placeholder implementation
    return [];
  }

  private analyzePerformanceByTimeOfDay(scans: any[]): PerformanceMetrics['breakdown']['byTimeOfDay'] {
    // Analyze performance by time of day - placeholder implementation
    return [];
  }

  private generatePerformanceTrends(scans: any[]): PerformanceMetrics['trends'] {
    // Generate performance trends - placeholder implementation
    return [];
  }

  private async detectRapidScanning(period: { startDate: Date; endDate: Date }): Promise<any[]> {
    // Detect rapid scanning patterns - placeholder implementation
    return [];
  }

  private async detectGeographicAnomalies(period: { startDate: Date; endDate: Date }): Promise<any[]> {
    // Detect geographic anomalies - placeholder implementation
    return [];
  }

  private async detectBotActivity(period: { startDate: Date; endDate: Date }): Promise<any[]> {
    // Detect bot-like scanning behavior - placeholder implementation
    return [];
  }

  private convertToCSV(report: AnalyticsReport): string {
    // Convert report to CSV format - placeholder implementation
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Scans', report.summary.totalScans.toString()],
      ['Successful Scans', report.summary.successfulScans.toString()],
      ['Failed Scans', report.summary.failedScans.toString()],
      ['Geographic Reach', report.summary.geographicalReach.toString()]
    ];

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  private async convertToExcel(report: AnalyticsReport): Promise<Buffer> {
    // Convert report to Excel format - would require a library like xlsx
    // Placeholder implementation
    return Buffer.from('Excel export not implemented');
  }

  /**
   * Cleanup and stop processing
   */
  async stop(): Promise<void> {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }

    // Process remaining events
    if (this.eventBuffer.length > 0) {
      await this.processEventBuffer();
    }

    console.log('📊 QR Code Analytics Service stopped');
  }

  /**
   * Get service configuration
   */
  getConfig(): AnalyticsConfig {
    return { ...this.config };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ Analytics service configuration updated');
  }
}

// Create singleton instance
let analyticsService: QrCodeAnalyticsService | null = null;

/**
 * Get singleton analytics service instance
 */
export const getQrCodeAnalyticsService = (config?: Partial<AnalyticsConfig>): QrCodeAnalyticsService => {
  if (!analyticsService) {
    analyticsService = new QrCodeAnalyticsService(config);
  }
  return analyticsService;
};

/**
 * Track QR code scan (convenience function)
 */
export const trackQrCodeScan = async (
  qrCodeId: string,
  scanContext: any
): Promise<void> => {
  const service = getQrCodeAnalyticsService();
  await service.trackScanEvent({
    eventType: 'scan',
    qrCodeId,
    context: scanContext
  });
};

export default QrCodeAnalyticsService;