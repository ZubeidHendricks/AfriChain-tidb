/**
 * Fraud Detection Service
 * 
 * Comprehensive fraud detection system that analyzes verification patterns,
 * detects anomalies, and provides real-time fraud scoring and alerting.
 */

import Database from '../config/database';
import crypto from 'crypto';

export interface VerificationAttempt {
  id: string;
  productId: string;
  qrCodeData: string;
  verificationResult: 'authentic' | 'counterfeit' | 'suspicious';
  timestamp: string;
  deviceFingerprint: DeviceFingerprint;
  geolocation?: GeolocationData;
  userAgent: string;
  ipAddress: string;
  sessionId: string;
  verificationScore: number;
}

export interface DeviceFingerprint {
  browserFingerprint: string;
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  userAgentHash: string;
  canvasFingerprint?: string;
  webglFingerprint?: string;
}

export interface GeolocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  city?: string;
  country?: string;
  region?: string;
  anonymizedLocationHash: string;
}

export interface FraudScore {
  productId: string;
  overallScore: number; // 0-100, higher means more suspicious
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: FraudFactor[];
  lastUpdated: string;
  verificationCount: number;
  suspiciousAttempts: number;
}

export interface FraudFactor {
  type: 'duplicate_qr' | 'geographic_anomaly' | 'device_anomaly' | 'frequency_anomaly' | 'pattern_anomaly';
  severity: number; // 0-10
  description: string;
  evidence: any;
  detectedAt: string;
}

export interface FraudAlert {
  id: string;
  productId: string;
  alertType: 'real_time' | 'pattern_detected' | 'threshold_exceeded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  evidence: any;
  timestamp: string;
  status: 'new' | 'investigating' | 'resolved' | 'false_positive';
  assignedTo?: string;
}

export interface FraudPattern {
  id: string;
  patternType: 'duplicate_qr' | 'mass_verification' | 'geographic_clustering' | 'device_farming';
  description: string;
  affectedProducts: string[];
  detectionScore: number;
  firstDetected: string;
  lastSeen: string;
  occurrenceCount: number;
  isActive: boolean;
}

export class FraudDetectionService {
  private db: Database;
  private readonly MAX_VERIFICATIONS_PER_HOUR = 10;
  private readonly SUSPICIOUS_SCORE_THRESHOLD = 70;
  private readonly CRITICAL_SCORE_THRESHOLD = 90;
  private readonly GEOGRAPHIC_RADIUS_KM = 50;

  constructor() {
    this.db = Database.getInstance();
  }

  /**
   * Log comprehensive verification attempt with fraud detection data
   */
  async logVerificationAttempt(attempt: VerificationAttempt): Promise<void> {
    try {
      // Hash sensitive data for privacy compliance
      const hashedIp = this.hashString(attempt.ipAddress);
      const deviceFingerprintHash = this.hashDeviceFingerprint(attempt.deviceFingerprint);
      
      // Store verification attempt with privacy protection
      const logEntry = {
        id: attempt.id,
        product_id: attempt.productId,
        qr_code_hash: this.hashString(attempt.qrCodeData),
        verification_result: attempt.verificationResult,
        timestamp: attempt.timestamp,
        device_fingerprint_hash: deviceFingerprintHash,
        geolocation_hash: attempt.geolocation?.anonymizedLocationHash,
        user_agent_hash: this.hashString(attempt.userAgent),
        ip_hash: hashedIp,
        session_id_hash: this.hashString(attempt.sessionId),
        verification_score: attempt.verificationScore,
        created_at: new Date().toISOString(),
      };

      await this.storeVerificationAttempt(logEntry);

      // Immediate fraud analysis
      await this.performRealTimeFraudAnalysis(attempt);

      console.log('Verification attempt logged for fraud detection:', {
        id: attempt.id,
        productId: attempt.productId,
        result: attempt.verificationResult,
      });

    } catch (error) {
      console.error('Failed to log verification attempt:', error);
      throw new Error('Fraud detection logging failed');
    }
  }

  /**
   * Perform real-time fraud analysis on verification attempt
   */
  private async performRealTimeFraudAnalysis(attempt: VerificationAttempt): Promise<void> {
    try {
      // Check for immediate fraud indicators
      const fraudFactors: FraudFactor[] = [];

      // 1. Check for duplicate QR code verifications
      const duplicateCheck = await this.checkDuplicateQRVerifications(attempt);
      if (duplicateCheck.isDuplicate) {
        fraudFactors.push({
          type: 'duplicate_qr',
          severity: duplicateCheck.severity,
          description: `QR code verified ${duplicateCheck.count} times in the last hour`,
          evidence: { count: duplicateCheck.count, timeframe: '1 hour' },
          detectedAt: new Date().toISOString(),
        });
      }

      // 2. Check for geographic anomalies
      if (attempt.geolocation) {
        const geoAnomaly = await this.checkGeographicAnomalies(attempt);
        if (geoAnomaly.isAnomalous) {
          fraudFactors.push({
            type: 'geographic_anomaly',
            severity: geoAnomaly.severity,
            description: geoAnomaly.description,
            evidence: geoAnomaly.evidence,
            detectedAt: new Date().toISOString(),
          });
        }
      }

      // 3. Check for device fingerprint anomalies
      const deviceAnomaly = await this.checkDeviceAnomalies(attempt);
      if (deviceAnomaly.isAnomalous) {
        fraudFactors.push({
          type: 'device_anomaly',
          severity: deviceAnomaly.severity,
          description: deviceAnomaly.description,
          evidence: deviceAnomaly.evidence,
          detectedAt: new Date().toISOString(),
        });
      }

      // 4. Check verification frequency
      const frequencyAnomaly = await this.checkVerificationFrequency(attempt);
      if (frequencyAnomaly.isAnomalous) {
        fraudFactors.push({
          type: 'frequency_anomaly',
          severity: frequencyAnomaly.severity,
          description: frequencyAnomaly.description,
          evidence: frequencyAnomaly.evidence,
          detectedAt: new Date().toISOString(),
        });
      }

      // Calculate overall fraud score
      if (fraudFactors.length > 0) {
        await this.updateFraudScore(attempt.productId, fraudFactors);
        
        // Generate alerts if necessary
        const fraudScore = await this.getFraudScore(attempt.productId);
        if (fraudScore && fraudScore.overallScore >= this.SUSPICIOUS_SCORE_THRESHOLD) {
          await this.generateFraudAlert(attempt, fraudScore, fraudFactors);
        }
      }

    } catch (error) {
      console.error('Real-time fraud analysis failed:', error);
      // Don't throw error as this shouldn't break verification flow
    }
  }

  /**
   * Check for duplicate QR code verifications
   */
  private async checkDuplicateQRVerifications(attempt: VerificationAttempt): Promise<{
    isDuplicate: boolean;
    count: number;
    severity: number;
  }> {
    try {
      const qrHash = this.hashString(attempt.qrCodeData);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      // Count recent verifications of the same QR code
      const count = await this.countRecentQRVerifications(qrHash, hourAgo);
      
      const isDuplicate = count > this.MAX_VERIFICATIONS_PER_HOUR;
      const severity = Math.min(10, Math.floor(count / 2)); // Scale severity based on count
      
      return { isDuplicate, count, severity };

    } catch (error) {
      console.error('Duplicate QR check failed:', error);
      return { isDuplicate: false, count: 0, severity: 0 };
    }
  }

  /**
   * Check for geographic anomalies in verification patterns
   */
  private async checkGeographicAnomalies(attempt: VerificationAttempt): Promise<{
    isAnomalous: boolean;
    severity: number;
    description: string;
    evidence: any;
  }> {
    try {
      if (!attempt.geolocation) {
        return { isAnomalous: false, severity: 0, description: '', evidence: {} };
      }

      // Get recent verifications for this product in different locations
      const recentLocations = await this.getRecentVerificationLocations(
        attempt.productId, 
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );

      // Check for impossible travel distances
      let maxDistanceKm = 0;
      let shortestTimeDiff = Infinity;
      
      for (const location of recentLocations) {
        const distance = this.calculateDistance(
          attempt.geolocation.latitude,
          attempt.geolocation.longitude,
          location.latitude,
          location.longitude
        );
        
        const timeDiff = new Date(attempt.timestamp).getTime() - new Date(location.timestamp).getTime();
        const timeDiffHours = timeDiff / (1000 * 60 * 60);
        
        if (distance > maxDistanceKm) {
          maxDistanceKm = distance;
        }
        
        if (timeDiffHours > 0 && timeDiffHours < shortestTimeDiff) {
          shortestTimeDiff = timeDiffHours;
        }
      }

      // Flag if impossible travel speed (>500 km/h consistently)
      const isImpossibleTravel = maxDistanceKm > 500 && shortestTimeDiff < 1;
      const isHighlyDispersed = recentLocations.length > 5 && maxDistanceKm > 1000;
      
      const isAnomalous = isImpossibleTravel || isHighlyDispersed;
      const severity = isImpossibleTravel ? 9 : (isHighlyDispersed ? 6 : 0);
      
      return {
        isAnomalous,
        severity,
        description: isImpossibleTravel 
          ? `Impossible travel speed detected: ${Math.round(maxDistanceKm / shortestTimeDiff)} km/h`
          : `High geographic dispersion: ${recentLocations.length} locations spanning ${Math.round(maxDistanceKm)} km`,
        evidence: {
          maxDistanceKm,
          locationCount: recentLocations.length,
          impossibleTravel: isImpossibleTravel,
        },
      };

    } catch (error) {
      console.error('Geographic anomaly check failed:', error);
      return { isAnomalous: false, severity: 0, description: '', evidence: {} };
    }
  }

  /**
   * Check for device fingerprint anomalies
   */
  private async checkDeviceAnomalies(attempt: VerificationAttempt): Promise<{
    isAnomalous: boolean;
    severity: number;
    description: string;
    evidence: any;
  }> {
    try {
      const deviceHash = this.hashDeviceFingerprint(attempt.deviceFingerprint);
      
      // Check for device fingerprint reuse across different products
      const recentDeviceUsage = await this.getRecentDeviceUsage(
        deviceHash,
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );

      const uniqueProducts = new Set(recentDeviceUsage.map(usage => usage.productId));
      const isHighVolumeDevice = uniqueProducts.size > 10;
      const isRapidVerifications = recentDeviceUsage.length > 50;
      
      const isAnomalous = isHighVolumeDevice || isRapidVerifications;
      const severity = isRapidVerifications ? 8 : (isHighVolumeDevice ? 6 : 0);
      
      return {
        isAnomalous,
        severity,
        description: isRapidVerifications
          ? `Device performed ${recentDeviceUsage.length} verifications in 24 hours`
          : `Device verified ${uniqueProducts.size} different products in 24 hours`,
        evidence: {
          verificationCount: recentDeviceUsage.length,
          uniqueProducts: uniqueProducts.size,
          deviceFingerprint: deviceHash.substring(0, 16) + '...',
        },
      };

    } catch (error) {
      console.error('Device anomaly check failed:', error);
      return { isAnomalous: false, severity: 0, description: '', evidence: {} };
    }
  }

  /**
   * Check verification frequency patterns
   */
  private async checkVerificationFrequency(attempt: VerificationAttempt): Promise<{
    isAnomalous: boolean;
    severity: number;
    description: string;
    evidence: any;
  }> {
    try {
      const hourlyCount = await this.countRecentProductVerifications(
        attempt.productId,
        new Date(Date.now() - 60 * 60 * 1000).toISOString()
      );

      const dailyCount = await this.countRecentProductVerifications(
        attempt.productId,
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );

      const isHighHourlyFrequency = hourlyCount > 20;
      const isHighDailyFrequency = dailyCount > 100;
      
      const isAnomalous = isHighHourlyFrequency || isHighDailyFrequency;
      const severity = isHighHourlyFrequency ? 9 : (isHighDailyFrequency ? 7 : 0);
      
      return {
        isAnomalous,
        severity,
        description: isHighHourlyFrequency
          ? `${hourlyCount} verifications in the last hour`
          : `${dailyCount} verifications in the last 24 hours`,
        evidence: {
          hourlyCount,
          dailyCount,
          productId: attempt.productId,
        },
      };

    } catch (error) {
      console.error('Frequency anomaly check failed:', error);
      return { isAnomalous: false, severity: 0, description: '', evidence: {} };
    }
  }

  /**
   * Update fraud score for a product
   */
  private async updateFraudScore(productId: string, fraudFactors: FraudFactor[]): Promise<void> {
    try {
      const existingScore = await this.getFraudScore(productId);
      const baseScore = existingScore?.overallScore || 0;
      
      // Calculate new score based on fraud factors
      const factorScore = fraudFactors.reduce((sum, factor) => sum + factor.severity * 5, 0);
      const newScore = Math.min(100, baseScore + factorScore);
      
      // Determine risk level
      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      if (newScore >= this.CRITICAL_SCORE_THRESHOLD) riskLevel = 'critical';
      else if (newScore >= this.SUSPICIOUS_SCORE_THRESHOLD) riskLevel = 'high';
      else if (newScore >= 40) riskLevel = 'medium';
      else riskLevel = 'low';

      const updatedScore: FraudScore = {
        productId,
        overallScore: newScore,
        riskLevel,
        factors: [...(existingScore?.factors || []), ...fraudFactors],
        lastUpdated: new Date().toISOString(),
        verificationCount: (existingScore?.verificationCount || 0) + 1,
        suspiciousAttempts: (existingScore?.suspiciousAttempts || 0) + (fraudFactors.length > 0 ? 1 : 0),
      };

      await this.storeFraudScore(updatedScore);

    } catch (error) {
      console.error('Failed to update fraud score:', error);
      throw error;
    }
  }

  /**
   * Generate fraud alert
   */
  private async generateFraudAlert(
    attempt: VerificationAttempt,
    fraudScore: FraudScore,
    fraudFactors: FraudFactor[]
  ): Promise<void> {
    try {
      const alert: FraudAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        productId: attempt.productId,
        alertType: 'real_time',
        severity: fraudScore.riskLevel,
        message: `Suspicious verification detected for product ${attempt.productId}. Score: ${fraudScore.overallScore}/100`,
        evidence: {
          verificationAttempt: {
            id: attempt.id,
            timestamp: attempt.timestamp,
            result: attempt.verificationResult,
          },
          fraudFactors: fraudFactors.map(factor => ({
            type: factor.type,
            severity: factor.severity,
            description: factor.description,
          })),
          fraudScore: {
            overall: fraudScore.overallScore,
            riskLevel: fraudScore.riskLevel,
          },
        },
        timestamp: new Date().toISOString(),
        status: 'new',
      };

      await this.storeFraudAlert(alert);

      // Send notifications for high severity alerts
      if (alert.severity === 'critical' || alert.severity === 'high') {
        await this.sendFraudAlert(alert);
      }

    } catch (error) {
      console.error('Failed to generate fraud alert:', error);
      throw error;
    }
  }

  /**
   * Get fraud score for a product
   */
  async getFraudScore(productId: string): Promise<FraudScore | null> {
    try {
      // This would typically query a fraud_scores table
      // For now, return mock data
      return null;

    } catch (error) {
      console.error('Failed to get fraud score:', error);
      return null;
    }
  }

  /**
   * Get fraud analytics summary
   */
  async getFraudAnalytics(timeframe: 'day' | 'week' | 'month' = 'week'): Promise<{
    totalAlerts: number;
    alertsByseverity: Record<string, number>;
    topFraudTypes: Array<{ type: string; count: number }>;
    fraudTrend: Array<{ date: string; alertCount: number; score: number }>;
    affectedProducts: number;
    falsePositiveRate: number;
  }> {
    try {
      // Mock fraud analytics data
      return {
        totalAlerts: 156,
        alertsBySeverity: {
          critical: 12,
          high: 28,
          medium: 67,
          low: 49,
        },
        topFraudTypes: [
          { type: 'duplicate_qr', count: 45 },
          { type: 'frequency_anomaly', count: 38 },
          { type: 'geographic_anomaly', count: 28 },
          { type: 'device_anomaly', count: 25 },
          { type: 'pattern_anomaly', count: 20 },
        ],
        fraudTrend: this.generateFraudTrend(timeframe),
        affectedProducts: 78,
        falsePositiveRate: 4.2, // Percentage
      };

    } catch (error) {
      console.error('Failed to get fraud analytics:', error);
      throw new Error('Fraud analytics retrieval failed');
    }
  }

  // Private helper methods

  private hashString(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private hashDeviceFingerprint(fingerprint: DeviceFingerprint): string {
    const fingerprintString = JSON.stringify(fingerprint);
    return this.hashString(fingerprintString);
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }

  private generateFraudTrend(timeframe: string): Array<{ date: string; alertCount: number; score: number }> {
    const days = timeframe === 'day' ? 1 : timeframe === 'week' ? 7 : 30;
    const trend = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      trend.push({
        date: date.toISOString().split('T')[0],
        alertCount: Math.floor(Math.random() * 20) + 5,
        score: Math.floor(Math.random() * 30) + 20,
      });
    }
    
    return trend;
  }

  // Database interaction methods (would be implemented with actual DB)

  private async storeVerificationAttempt(logEntry: any): Promise<void> {
    console.log('Storing verification attempt:', logEntry.id);
    // Implementation would insert into verification_attempts table
  }

  private async storeFraudScore(fraudScore: FraudScore): Promise<void> {
    console.log('Storing fraud score:', fraudScore.productId, fraudScore.overallScore);
    // Implementation would insert/update fraud_scores table
  }

  private async storeFraudAlert(alert: FraudAlert): Promise<void> {
    console.log('Storing fraud alert:', alert.id, alert.severity);
    // Implementation would insert into fraud_alerts table
  }

  private async countRecentQRVerifications(qrHash: string, since: string): Promise<number> {
    // Mock implementation
    return Math.floor(Math.random() * 15);
  }

  private async getRecentVerificationLocations(productId: string, since: string): Promise<Array<{
    latitude: number;
    longitude: number;
    timestamp: string;
  }>> {
    // Mock implementation
    return [];
  }

  private async getRecentDeviceUsage(deviceHash: string, since: string): Promise<Array<{
    productId: string;
    timestamp: string;
  }>> {
    // Mock implementation
    return [];
  }

  private async countRecentProductVerifications(productId: string, since: string): Promise<number> {
    // Mock implementation
    return Math.floor(Math.random() * 25);
  }

  private async sendFraudAlert(alert: FraudAlert): Promise<void> {
    console.log('Sending fraud alert notification:', alert.id, alert.severity);
    // Implementation would send email/SMS notifications
  }
}

// Export singleton instance
export const fraudDetectionService = new FraudDetectionService();

export default fraudDetectionService;