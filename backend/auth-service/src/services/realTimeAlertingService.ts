/**
 * Real-Time Alerting Service
 * 
 * Comprehensive real-time fraud detection and alerting system featuring:
 * - Real-time fraud detection processing pipeline
 * - Immediate alerts for high-confidence fraud attempts
 * - Escalation system for different fraud severity levels
 * - Multi-channel administrator notifications (email/SMS/push)
 * - Alert prioritization and rate limiting
 * - Integration with fraud detection and pattern analysis services
 */

import Database from '../config/database';
import { EventEmitter } from 'events';
import { FraudAlert, FraudScore, VerificationAttempt } from './fraudDetectionService';
import { PatternAnalysisResult } from './patternDetectionService';

export interface AlertConfiguration {
  enabled: boolean;
  alertTypes: {
    realTime: boolean;
    patternDetected: boolean;
    thresholdExceeded: boolean;
    criticalFraud: boolean;
  };
  severityThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  notificationChannels: {
    email: boolean;
    sms: boolean;
    push: boolean;
    webhook: boolean;
    dashboard: boolean;
  };
  escalationRules: {
    criticalAlertEscalationMinutes: number;
    highAlertEscalationMinutes: number;
    maxEscalationLevel: number;
  };
  rateLimiting: {
    maxAlertsPerMinute: number;
    maxAlertsPerHour: number;
    duplicateSuppressionMinutes: number;
  };
}

export interface AlertRecipient {
  id: string;
  name: string;
  role: 'admin' | 'security_analyst' | 'manager' | 'developer';
  contacts: {
    email?: string;
    phone?: string;
    pushToken?: string;
  };
  alertPreferences: {
    severityLevels: Array<'low' | 'medium' | 'high' | 'critical'>;
    channels: Array<'email' | 'sms' | 'push'>;
    scheduleRestrictions?: {
      timezone: string;
      quietHours: { start: string; end: string };
      weekendsOnly?: boolean;
    };
  };
  escalationLevel: number; // 1 = primary, 2 = secondary, etc.
}

export interface ProcessedAlert extends FraudAlert {
  processed: boolean;
  processingTimestamp: string;
  recipientsSent: string[];
  channelsUsed: string[];
  escalationLevel: number;
  suppressedDuplicates: number;
  responseRequired: boolean;
  acknowledgment?: {
    acknowledgedBy: string;
    acknowledgedAt: string;
    response: 'investigating' | 'false_positive' | 'confirmed_fraud' | 'escalated';
    notes?: string;
  };
  resolution?: {
    resolvedBy: string;
    resolvedAt: string;
    resolution: 'resolved' | 'false_positive' | 'fraud_confirmed' | 'ongoing';
    actionsTaken: string[];
    followUpRequired: boolean;
  };
}

export interface AlertProcessingPipeline {
  incomingAlerts: number;
  processedAlerts: number;
  suppressedAlerts: number;
  failedAlerts: number;
  averageProcessingTime: number;
  alertBacklog: number;
  lastProcessingTimestamp: string;
}

export interface NotificationDeliveryResult {
  alertId: string;
  recipient: string;
  channel: 'email' | 'sms' | 'push' | 'webhook';
  delivered: boolean;
  deliveryTimestamp: string;
  error?: string;
  deliveryLatency: number; // milliseconds
}

export class RealTimeAlertingService extends EventEmitter {
  private db: Database;
  private alertQueue: FraudAlert[] = [];
  private processingActive: boolean = false;
  private alertsSentThisMinute: number = 0;
  private alertsSentThisHour: number = 0;
  private lastMinuteReset: number = Date.now();
  private lastHourReset: number = Date.now();
  private recentAlerts: Map<string, number> = new Map(); // For duplicate suppression

  private readonly DEFAULT_CONFIG: AlertConfiguration = {
    enabled: true,
    alertTypes: {
      realTime: true,
      patternDetected: true,
      thresholdExceeded: true,
      criticalFraud: true,
    },
    severityThresholds: {
      low: 30,
      medium: 50,
      high: 70,
      critical: 90,
    },
    notificationChannels: {
      email: true,
      sms: true,
      push: true,
      webhook: true,
      dashboard: true,
    },
    escalationRules: {
      criticalAlertEscalationMinutes: 5,
      highAlertEscalationMinutes: 15,
      maxEscalationLevel: 3,
    },
    rateLimiting: {
      maxAlertsPerMinute: 10,
      maxAlertsPerHour: 50,
      duplicateSuppressionMinutes: 5,
    },
  };

  constructor() {
    super();
    this.db = Database.getInstance();
    this.startProcessingPipeline();
    this.startEscalationMonitoring();
    this.startRateLimitReset();
  }

  /**
   * Process real-time fraud alert
   */
  async processRealTimeAlert(alert: FraudAlert): Promise<void> {
    try {
      // Validate alert
      if (!this.isValidAlert(alert)) {
        console.error('Invalid alert received:', alert.id);
        return;
      }

      // Check if alerting is enabled
      const config = await this.getAlertConfiguration();
      if (!config.enabled) {
        console.log('Alerting is disabled, skipping alert:', alert.id);
        return;
      }

      // Check for duplicate suppression
      if (this.isDuplicateAlert(alert, config)) {
        console.log('Suppressing duplicate alert:', alert.id);
        await this.incrementSuppressedCount(alert);
        return;
      }

      // Check rate limits
      if (!this.checkRateLimit(config)) {
        console.warn('Rate limit exceeded, queuing alert:', alert.id);
        this.alertQueue.push(alert);
        return;
      }

      // Process alert immediately
      await this.processAlert(alert, config);

      // Emit event for real-time dashboard updates
      this.emit('alertProcessed', alert);

      console.log('Real-time alert processed successfully:', {
        alertId: alert.id,
        severity: alert.severity,
        productId: alert.productId,
      });

    } catch (error) {
      console.error('Failed to process real-time alert:', error);
      // Store failed alert for retry
      await this.storeFaield Alert(alert, error);
    }
  }

  /**
   * Process pattern analysis results and generate alerts
   */
  async processPatternAnalysisResults(analysisResult: PatternAnalysisResult): Promise<void> {
    try {
      const config = await this.getAlertConfiguration();

      // Generate alerts based on pattern analysis
      const alerts: FraudAlert[] = [];

      // High-risk duplicate patterns
      for (const pattern of analysisResult.duplicatePatterns) {
        if (pattern.riskScore >= config.severityThresholds.high) {
          alerts.push({
            id: `pattern_dup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            productId: 'multiple', // Multiple products affected
            alertType: 'pattern_detected',
            severity: pattern.riskScore >= config.severityThresholds.critical ? 'critical' : 'high',
            message: `Duplicate QR pattern detected: ${pattern.verificationCount} verifications of same QR code`,
            evidence: {
              patternType: 'duplicate_qr',
              riskScore: pattern.riskScore,
              verificationCount: pattern.verificationCount,
              timeSpread: pattern.timeSpread,
              suspiciousBehavior: pattern.suspiciousBehavior,
            },
            timestamp: new Date().toISOString(),
            status: 'new',
          });
        }
      }

      // High-confidence suspicious patterns
      for (const pattern of analysisResult.suspiciousPatterns) {
        if (pattern.confidence >= config.severityThresholds.high) {
          alerts.push({
            id: `pattern_sus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            productId: pattern.affectedProducts.join(','),
            alertType: 'pattern_detected',
            severity: pattern.confidence >= config.severityThresholds.critical ? 'critical' : 'high',
            message: `Suspicious pattern detected: ${pattern.patternType}`,
            evidence: {
              patternType: pattern.patternType,
              confidence: pattern.confidence,
              affectedProducts: pattern.affectedProducts,
              evidenceStrength: pattern.evidenceStrength,
            },
            timestamp: new Date().toISOString(),
            status: 'new',
          });
        }
      }

      // Critical anomaly patterns
      for (const pattern of analysisResult.anomalyPatterns) {
        if (pattern.severity === 'critical' || pattern.severity === 'high') {
          alerts.push({
            id: `pattern_anom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            productId: pattern.productId,
            alertType: 'pattern_detected',
            severity: pattern.severity,
            message: `Anomaly detected: ${pattern.anomalyType} for product ${pattern.productId}`,
            evidence: {
              anomalyType: pattern.anomalyType,
              deviationScore: pattern.deviationScore,
              normalBaseline: pattern.normalBaseline,
              anomalousValue: pattern.anomalousValue,
            },
            timestamp: new Date().toISOString(),
            status: 'new',
          });
        }
      }

      // Critical geographic clusters
      for (const cluster of analysisResult.geographicClusters) {
        if (cluster.riskLevel === 'critical' || cluster.riskLevel === 'high') {
          alerts.push({
            id: `pattern_geo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            productId: 'multiple',
            alertType: 'pattern_detected',
            severity: cluster.riskLevel,
            message: `Suspicious geographic cluster detected: ${cluster.verificationCount} verifications in ${cluster.radius.toFixed(1)}km radius`,
            evidence: {
              clusterId: cluster.clusterId,
              center: cluster.center,
              radius: cluster.radius,
              fraudProbability: cluster.fraudProbability,
              verificationCount: cluster.verificationCount,
            },
            timestamp: new Date().toISOString(),
            status: 'new',
          });
        }
      }

      // Process all generated alerts
      for (const alert of alerts) {
        await this.processRealTimeAlert(alert);
      }

      console.log('Pattern analysis alerts processed:', {
        totalPatterns: {
          duplicate: analysisResult.duplicatePatterns.length,
          suspicious: analysisResult.suspiciousPatterns.length,
          anomaly: analysisResult.anomalyPatterns.length,
          geographic: analysisResult.geographicClusters.length,
        },
        alertsGenerated: alerts.length,
        overallRisk: analysisResult.overallRiskAssessment.riskLevel,
      });

    } catch (error) {
      console.error('Failed to process pattern analysis results:', error);
      throw error;
    }
  }

  /**
   * Get alert processing pipeline status
   */
  async getAlertPipelineStatus(): Promise<AlertProcessingPipeline> {
    try {
      const status = await this.calculatePipelineStatistics();
      return status;
    } catch (error) {
      console.error('Failed to get pipeline status:', error);
      throw error;
    }
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string,
    response: 'investigating' | 'false_positive' | 'confirmed_fraud' | 'escalated',
    notes?: string
  ): Promise<void> {
    try {
      const acknowledgment = {
        acknowledgedBy,
        acknowledgedAt: new Date().toISOString(),
        response,
        notes,
      };

      await this.updateAlertAcknowledgment(alertId, acknowledgment);

      // Stop escalation if acknowledged
      if (response !== 'escalated') {
        await this.stopEscalation(alertId);
      }

      // Emit acknowledgment event
      this.emit('alertAcknowledged', { alertId, acknowledgment });

      console.log('Alert acknowledged:', { alertId, acknowledgedBy, response });

    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
      throw error;
    }
  }

  /**
   * Resolve alert
   */
  async resolveAlert(
    alertId: string,
    resolvedBy: string,
    resolution: 'resolved' | 'false_positive' | 'fraud_confirmed' | 'ongoing',
    actionsTaken: string[],
    followUpRequired: boolean = false
  ): Promise<void> {
    try {
      const resolutionData = {
        resolvedBy,
        resolvedAt: new Date().toISOString(),
        resolution,
        actionsTaken,
        followUpRequired,
      };

      await this.updateAlertResolution(alertId, resolutionData);

      // Update alert status
      await this.updateAlertStatus(alertId, 'resolved');

      // Stop escalation
      await this.stopEscalation(alertId);

      // Emit resolution event
      this.emit('alertResolved', { alertId, resolution: resolutionData });

      console.log('Alert resolved:', { alertId, resolvedBy, resolution });

    } catch (error) {
      console.error('Failed to resolve alert:', error);
      throw error;
    }
  }

  /**
   * Get real-time alert statistics
   */
  async getAlertStatistics(timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<{
    totalAlerts: number;
    alertsBySeverity: Record<string, number>;
    alertsByType: Record<string, number>;
    averageResponseTime: number;
    acknowledgmentRate: number;
    falsePositiveRate: number;
    escalationRate: number;
    topProducts: Array<{ productId: string; alertCount: number }>;
    alertTrend: Array<{ timestamp: string; count: number; severity: string }>;
  }> {
    try {
      const timeframHours = timeframe === 'hour' ? 1 : timeframe === 'day' ? 24 : 168;
      const startTime = new Date(Date.now() - timeframHours * 60 * 60 * 1000).toISOString();

      // Get alert statistics from database
      const statistics = await this.calculateAlertStatistics(startTime);

      return statistics;

    } catch (error) {
      console.error('Failed to get alert statistics:', error);
      throw error;
    }
  }

  // Private methods

  private async processAlert(alert: FraudAlert, config: AlertConfiguration): Promise<void> {
    const processedAlert: ProcessedAlert = {
      ...alert,
      processed: true,
      processingTimestamp: new Date().toISOString(),
      recipientsSent: [],
      channelsUsed: [],
      escalationLevel: 1,
      suppressedDuplicates: 0,
      responseRequired: alert.severity === 'critical' || alert.severity === 'high',
    };

    // Get alert recipients
    const recipients = await this.getAlertRecipients(alert.severity);

    // Send notifications
    for (const recipient of recipients) {
      if (recipient.escalationLevel === 1) { // Primary recipients only initially
        const deliveryResults = await this.sendNotifications(alert, recipient, config);
        processedAlert.recipientsSent.push(recipient.id);
        processedAlert.channelsUsed.push(...deliveryResults.map(r => r.channel));
      }
    }

    // Store processed alert
    await this.storeProcessedAlert(processedAlert);

    // Schedule escalation if needed
    if (processedAlert.responseRequired) {
      await this.scheduleEscalation(processedAlert, config);
    }

    // Update rate limiting counters
    this.updateRateLimitingCounters();

    // Add to duplicate suppression
    this.addToDuplicateSuppression(alert, config);
  }

  private async sendNotifications(
    alert: FraudAlert,
    recipient: AlertRecipient,
    config: AlertConfiguration
  ): Promise<NotificationDeliveryResult[]> {
    const results: NotificationDeliveryResult[] = [];

    // Check if recipient wants this severity level
    if (!recipient.alertPreferences.severityLevels.includes(alert.severity)) {
      return results;
    }

    // Check schedule restrictions
    if (!this.isWithinSchedule(recipient)) {
      return results;
    }

    // Send via preferred channels
    for (const channel of recipient.alertPreferences.channels) {
      if (config.notificationChannels[channel]) {
        try {
          const startTime = Date.now();
          await this.sendNotification(alert, recipient, channel);
          const deliveryLatency = Date.now() - startTime;

          results.push({
            alertId: alert.id,
            recipient: recipient.id,
            channel,
            delivered: true,
            deliveryTimestamp: new Date().toISOString(),
            deliveryLatency,
          });
        } catch (error) {
          results.push({
            alertId: alert.id,
            recipient: recipient.id,
            channel,
            delivered: false,
            deliveryTimestamp: new Date().toISOString(),
            error: error.message,
            deliveryLatency: 0,
          });
        }
      }
    }

    return results;
  }

  private async sendNotification(alert: FraudAlert, recipient: AlertRecipient, channel: string): Promise<void> {
    const message = this.formatAlertMessage(alert, recipient);

    switch (channel) {
      case 'email':
        await this.sendEmailNotification(recipient.contacts.email!, message, alert);
        break;
      case 'sms':
        await this.sendSMSNotification(recipient.contacts.phone!, message, alert);
        break;
      case 'push':
        await this.sendPushNotification(recipient.contacts.pushToken!, message, alert);
        break;
      default:
        throw new Error(`Unknown notification channel: ${channel}`);
    }
  }

  private formatAlertMessage(alert: FraudAlert, recipient: AlertRecipient): string {
    return `[${alert.severity.toUpperCase()}] AfriChain Fraud Alert
Product: ${alert.productId}
Type: ${alert.alertType}
Message: ${alert.message}
Time: ${new Date(alert.timestamp).toLocaleString()}
Alert ID: ${alert.id}

Please investigate immediately.`;
  }

  private async sendEmailNotification(email: string, message: string, alert: FraudAlert): Promise<void> {
    // Mock email sending implementation
    console.log(`Sending email to ${email}:`, message);
    // In production, would integrate with email service (SendGrid, AWS SES, etc.)
  }

  private async sendSMSNotification(phone: string, message: string, alert: FraudAlert): Promise<void> {
    // Mock SMS sending implementation
    console.log(`Sending SMS to ${phone}:`, message);
    // In production, would integrate with SMS service (Twilio, AWS SNS, etc.)
  }

  private async sendPushNotification(pushToken: string, message: string, alert: FraudAlert): Promise<void> {
    // Mock push notification implementation
    console.log(`Sending push to ${pushToken}:`, message);
    // In production, would integrate with push service (FCM, APNS, etc.)
  }

  private isValidAlert(alert: FraudAlert): boolean {
    return !!(alert.id && alert.productId && alert.severity && alert.message && alert.timestamp);
  }

  private isDuplicateAlert(alert: FraudAlert, config: AlertConfiguration): boolean {
    const alertKey = `${alert.productId}_${alert.alertType}_${alert.severity}`;
    const lastSeen = this.recentAlerts.get(alertKey);
    
    if (lastSeen) {
      const minutesSinceLastAlert = (Date.now() - lastSeen) / (1000 * 60);
      return minutesSinceLastAlert < config.rateLimiting.duplicateSuppressionMinutes;
    }
    
    return false;
  }

  private checkRateLimit(config: AlertConfiguration): boolean {
    this.resetRateLimitCountersIfNeeded();
    
    return (
      this.alertsSentThisMinute < config.rateLimiting.maxAlertsPerMinute &&
      this.alertsSentThisHour < config.rateLimiting.maxAlertsPerHour
    );
  }

  private updateRateLimitingCounters(): void {
    this.alertsSentThisMinute++;
    this.alertsSentThisHour++;
  }

  private addToDuplicateSuppression(alert: FraudAlert, config: AlertConfiguration): void {
    const alertKey = `${alert.productId}_${alert.alertType}_${alert.severity}`;
    this.recentAlerts.set(alertKey, Date.now());
  }

  private resetRateLimitCountersIfNeeded(): void {
    const now = Date.now();
    
    if (now - this.lastMinuteReset > 60000) {
      this.alertsSentThisMinute = 0;
      this.lastMinuteReset = now;
    }
    
    if (now - this.lastHourReset > 3600000) {
      this.alertsSentThisHour = 0;
      this.lastHourReset = now;
    }
  }

  private isWithinSchedule(recipient: AlertRecipient): boolean {
    // Simplified schedule check - in production would handle timezones properly
    if (!recipient.alertPreferences.scheduleRestrictions) {
      return true;
    }

    const now = new Date();
    const currentHour = now.getHours();
    
    // For simplicity, assume quiet hours are in 24-hour format
    const quietStart = parseInt(recipient.alertPreferences.scheduleRestrictions.quietHours.start);
    const quietEnd = parseInt(recipient.alertPreferences.scheduleRestrictions.quietHours.end);
    
    if (quietStart <= quietEnd) {
      return currentHour < quietStart || currentHour >= quietEnd;
    } else {
      return currentHour >= quietEnd && currentHour < quietStart;
    }
  }

  private startProcessingPipeline(): void {
    setInterval(async () => {
      if (this.alertQueue.length > 0 && !this.processingActive) {
        this.processingActive = true;
        try {
          const config = await this.getAlertConfiguration();
          while (this.alertQueue.length > 0 && this.checkRateLimit(config)) {
            const alert = this.alertQueue.shift()!;
            await this.processAlert(alert, config);
          }
        } catch (error) {
          console.error('Alert processing pipeline error:', error);
        } finally {
          this.processingActive = false;
        }
      }
    }, 1000); // Process every second
  }

  private startEscalationMonitoring(): void {
    setInterval(async () => {
      await this.checkForEscalation();
    }, 60000); // Check every minute
  }

  private startRateLimitReset(): void {
    setInterval(() => {
      this.resetRateLimitCountersIfNeeded();
      this.cleanupOldDuplicateSuppressions();
    }, 30000); // Check every 30 seconds
  }

  private cleanupOldDuplicateSuppressions(): void {
    const cutoff = Date.now() - (5 * 60 * 1000); // 5 minutes ago
    for (const [key, timestamp] of this.recentAlerts.entries()) {
      if (timestamp < cutoff) {
        this.recentAlerts.delete(key);
      }
    }
  }

  // Mock database and external service methods

  private async getAlertConfiguration(): Promise<AlertConfiguration> {
    return this.DEFAULT_CONFIG;
  }

  private async getAlertRecipients(severity: string): Promise<AlertRecipient[]> {
    // Mock recipients
    return [
      {
        id: 'admin1',
        name: 'System Administrator',
        role: 'admin',
        contacts: {
          email: 'admin@africhain.com',
          phone: '+234123456789',
          pushToken: 'push_token_123',
        },
        alertPreferences: {
          severityLevels: ['low', 'medium', 'high', 'critical'],
          channels: ['email', 'sms', 'push'],
        },
        escalationLevel: 1,
      },
      {
        id: 'security1',
        name: 'Security Analyst',
        role: 'security_analyst',
        contacts: {
          email: 'security@africhain.com',
          phone: '+234987654321',
        },
        alertPreferences: {
          severityLevels: ['high', 'critical'],
          channels: ['email', 'sms'],
        },
        escalationLevel: 2,
      },
    ];
  }

  private async storeProcessedAlert(alert: ProcessedAlert): Promise<void> {
    console.log('Storing processed alert:', alert.id);
  }

  private async storeFaiedAlert(alert: FraudAlert, error: any): Promise<void> {
    console.log('Storing failed alert:', alert.id, error.message);
  }

  private async scheduleEscalation(alert: ProcessedAlert, config: AlertConfiguration): Promise<void> {
    const escalationDelay = alert.severity === 'critical' 
      ? config.escalationRules.criticalAlertEscalationMinutes
      : config.escalationRules.highAlertEscalationMinutes;
    
    console.log(`Escalation scheduled for alert ${alert.id} in ${escalationDelay} minutes`);
  }

  private async checkForEscalation(): Promise<void> {
    // Check for alerts that need escalation
    console.log('Checking for escalation...');
  }

  private async stopEscalation(alertId: string): Promise<void> {
    console.log('Stopping escalation for alert:', alertId);
  }

  private async updateAlertAcknowledgment(alertId: string, acknowledgment: any): Promise<void> {
    console.log('Updating alert acknowledgment:', alertId);
  }

  private async updateAlertResolution(alertId: string, resolution: any): Promise<void> {
    console.log('Updating alert resolution:', alertId);
  }

  private async updateAlertStatus(alertId: string, status: string): Promise<void> {
    console.log('Updating alert status:', alertId, status);
  }

  private async incrementSuppressedCount(alert: FraudAlert): Promise<void> {
    console.log('Incrementing suppressed count for alert type:', alert.alertType);
  }

  private async calculatePipelineStatistics(): Promise<AlertProcessingPipeline> {
    return {
      incomingAlerts: 156,
      processedAlerts: 142,
      suppressedAlerts: 23,
      failedAlerts: 2,
      averageProcessingTime: 245, // milliseconds
      alertBacklog: this.alertQueue.length,
      lastProcessingTimestamp: new Date().toISOString(),
    };
  }

  private async calculateAlertStatistics(startTime: string): Promise<any> {
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
      averageResponseTime: 324, // seconds
      acknowledgmentRate: 94.4, // percentage
      falsePositiveRate: 3.2, // percentage
      escalationRate: 8.9, // percentage
      topProducts: [
        { productId: 'prod123', alertCount: 15 },
        { productId: 'prod456', alertCount: 12 },
        { productId: 'prod789', alertCount: 8 },
      ],
      alertTrend: Array.from({length: 24}, (_, i) => ({
        timestamp: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
        count: Math.floor(Math.random() * 10) + 1,
        severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
      })),
    };
  }
}

// Export singleton instance
export const realTimeAlertingService = new RealTimeAlertingService();

export default realTimeAlertingService;