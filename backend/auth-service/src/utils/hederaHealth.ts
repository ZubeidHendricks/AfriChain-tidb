import { getHederaClientManager, HederaHealthStatus } from '../config/hedera';
import { Hbar } from '@hashgraph/sdk';

/**
 * Network status information
 */
export interface NetworkStatus {
  isConnected: boolean;
  latency: number; // milliseconds
  lastCheck: Date;
  error?: string;
}

/**
 * Account status information
 */
export interface AccountStatus {
  accountId: string;
  balance: string;
  isActive: boolean;
  lastUpdated: Date;
  error?: string;
}

/**
 * Comprehensive health report
 */
export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  hedera: HederaHealthStatus;
  network: NetworkStatus;
  operator: AccountStatus;
  treasury: AccountStatus;
  recommendations: string[];
  lastUpdated: Date;
}

/**
 * Health monitoring configuration
 */
export interface HealthConfig {
  minOperatorBalance: number; // HBAR
  minTreasuryBalance: number; // HBAR
  maxLatency: number; // milliseconds
  healthCheckInterval: number; // milliseconds
  retryAttempts: number;
}

/**
 * Hedera Health Monitor
 * Provides comprehensive health monitoring and alerting
 */
export class HederaHealthMonitor {
  private config: HealthConfig;
  private lastHealthReport: HealthReport | null = null;
  private monitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<HealthConfig>) {
    this.config = {
      minOperatorBalance: 10, // 10 HBAR minimum
      minTreasuryBalance: 100, // 100 HBAR minimum for minting operations
      maxLatency: 5000, // 5 seconds maximum latency
      healthCheckInterval: 60000, // Check every minute
      retryAttempts: 3,
      ...config
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthReport> {
    const startTime = Date.now();
    console.log('🏥 Performing comprehensive Hedera health check...');

    try {
      const manager = getHederaClientManager();
      
      // Get Hedera service health status
      const hederaHealth = await manager.getHealthStatusWithRefresh();
      
      // Perform network latency test
      const network = await this.checkNetworkStatus();
      
      // Check operator account status
      const operator = await this.checkAccountStatus(
        manager.getConfig().operatorId,
        this.config.minOperatorBalance
      );
      
      // Check treasury account status
      const treasury = await this.checkAccountStatus(
        manager.getConfig().treasuryId,
        this.config.minTreasuryBalance
      );
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(hederaHealth, network, operator, treasury);
      
      // Determine overall health status
      const overall = this.determineOverallHealth(hederaHealth, network, operator, treasury);
      
      const healthReport: HealthReport = {
        overall,
        hedera: hederaHealth,
        network,
        operator,
        treasury,
        recommendations,
        lastUpdated: new Date()
      };

      this.lastHealthReport = healthReport;
      
      const checkTime = Date.now() - startTime;
      console.log(`✅ Health check completed in ${checkTime}ms (Status: ${overall})`);
      
      return healthReport;

    } catch (error) {
      console.error('❌ Health check failed:', error);
      
      const errorReport: HealthReport = {
        overall: 'unhealthy',
        hedera: {
          status: 'unhealthy',
          networkType: 'unknown',
          operatorAccount: 'unknown',
          treasuryAccount: 'unknown',
          error: error instanceof Error ? error.message : 'Health check failed'
        },
        network: {
          isConnected: false,
          latency: -1,
          lastCheck: new Date(),
          error: error instanceof Error ? error.message : 'Network check failed'
        },
        operator: {
          accountId: 'unknown',
          balance: '0',
          isActive: false,
          lastUpdated: new Date(),
          error: 'Unable to check operator account'
        },
        treasury: {
          accountId: 'unknown',
          balance: '0',
          isActive: false,
          lastUpdated: new Date(),
          error: 'Unable to check treasury account'
        },
        recommendations: ['Fix Hedera connection issues before proceeding'],
        lastUpdated: new Date()
      };

      this.lastHealthReport = errorReport;
      return errorReport;
    }
  }

  /**
   * Check network connectivity and latency
   */
  private async checkNetworkStatus(): Promise<NetworkStatus> {
    const startTime = Date.now();
    
    try {
      const manager = getHederaClientManager();
      const client = await manager.getClient();
      
      // Perform a simple query to test connectivity
      const operatorId = manager.getOperatorId();
      await client.getAccountInfo(operatorId);
      
      const latency = Date.now() - startTime;
      
      return {
        isConnected: true,
        latency,
        lastCheck: new Date()
      };
      
    } catch (error) {
      return {
        isConnected: false,
        latency: Date.now() - startTime,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Network connection failed'
      };
    }
  }

  /**
   * Check individual account status
   */
  private async checkAccountStatus(accountId: string, minBalance: number): Promise<AccountStatus> {
    try {
      const manager = getHederaClientManager();
      const client = await manager.getClient();
      
      // Get account balance
      const balance = await client.getAccountBalance(accountId);
      const balanceHbar = balance.hbars;
      const balanceAmount = balanceHbar.toTinybars().toNumber() / 100000000; // Convert to HBAR
      
      const isActive = balanceAmount >= minBalance;
      
      return {
        accountId,
        balance: balanceHbar.toString(),
        isActive,
        lastUpdated: new Date()
      };
      
    } catch (error) {
      return {
        accountId,
        balance: '0 HBAR',
        isActive: false,
        lastUpdated: new Date(),
        error: error instanceof Error ? error.message : 'Account check failed'
      };
    }
  }

  /**
   * Generate health recommendations
   */
  private generateRecommendations(
    hedera: HederaHealthStatus,
    network: NetworkStatus,
    operator: AccountStatus,
    treasury: AccountStatus
  ): string[] {
    const recommendations: string[] = [];

    // Hedera service recommendations
    if (hedera.status === 'unhealthy') {
      recommendations.push('Check Hedera service configuration and credentials');
    }

    // Network recommendations
    if (!network.isConnected) {
      recommendations.push('Verify network connectivity to Hedera nodes');
    }
    if (network.latency > this.config.maxLatency) {
      recommendations.push(`High network latency detected (${network.latency}ms). Consider network optimization`);
    }

    // Operator account recommendations
    if (!operator.isActive) {
      recommendations.push(`Operator account balance is low. Minimum ${this.config.minOperatorBalance} HBAR required`);
    }
    if (operator.error) {
      recommendations.push('Verify operator account credentials and permissions');
    }

    // Treasury account recommendations
    if (!treasury.isActive) {
      recommendations.push(`Treasury account balance is low. Minimum ${this.config.minTreasuryBalance} HBAR required for minting operations`);
    }
    if (treasury.error) {
      recommendations.push('Verify treasury account credentials and permissions');
    }

    // General recommendations
    if (recommendations.length === 0) {
      recommendations.push('System is healthy. Regular monitoring recommended');
    }

    return recommendations;
  }

  /**
   * Determine overall system health
   */
  private determineOverallHealth(
    hedera: HederaHealthStatus,
    network: NetworkStatus,
    operator: AccountStatus,
    treasury: AccountStatus
  ): 'healthy' | 'degraded' | 'unhealthy' {
    // Critical failures = unhealthy
    if (hedera.status === 'unhealthy' || !network.isConnected) {
      return 'unhealthy';
    }

    // Account issues or high latency = degraded
    if (!operator.isActive || !treasury.isActive || network.latency > this.config.maxLatency) {
      return 'degraded';
    }

    // All checks pass = healthy
    return 'healthy';
  }

  /**
   * Get the last health report
   */
  getLastHealthReport(): HealthReport | null {
    return this.lastHealthReport;
  }

  /**
   * Start continuous health monitoring
   */
  startMonitoring(): void {
    if (this.monitoring) {
      console.log('⚠️ Health monitoring already running');
      return;
    }

    console.log(`🔄 Starting Hedera health monitoring (interval: ${this.config.healthCheckInterval}ms)`);
    this.monitoring = true;

    // Perform initial health check
    this.performHealthCheck().catch(error => {
      console.error('❌ Initial health check failed:', error);
    });

    // Set up interval monitoring
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('❌ Scheduled health check failed:', error);
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop continuous health monitoring
   */
  stopMonitoring(): void {
    if (!this.monitoring) {
      console.log('⚠️ Health monitoring is not running');
      return;
    }

    console.log('🛑 Stopping Hedera health monitoring');
    this.monitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean {
    return this.monitoring;
  }

  /**
   * Get monitoring configuration
   */
  getConfig(): HealthConfig {
    return { ...this.config };
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(newConfig: Partial<HealthConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ Health monitoring configuration updated');
  }

  /**
   * Get health status summary for API responses
   */
  getHealthSummary(): {
    status: string;
    isHealthy: boolean;
    lastCheck?: Date;
    issues: string[];
  } {
    const report = this.lastHealthReport;
    
    if (!report) {
      return {
        status: 'unknown',
        isHealthy: false,
        issues: ['Health check not performed yet']
      };
    }

    return {
      status: report.overall,
      isHealthy: report.overall === 'healthy',
      lastCheck: report.lastUpdated,
      issues: report.recommendations.filter(rec => !rec.includes('healthy'))
    };
  }
}

// Create singleton instance
let healthMonitor: HederaHealthMonitor | null = null;

/**
 * Get singleton health monitor instance
 */
export const getHederaHealthMonitor = (config?: Partial<HealthConfig>): HederaHealthMonitor => {
  if (!healthMonitor) {
    healthMonitor = new HederaHealthMonitor(config);
  }
  return healthMonitor;
};

/**
 * Initialize health monitoring with default configuration
 */
export const initializeHealthMonitoring = (config?: Partial<HealthConfig>): HederaHealthMonitor => {
  const monitor = getHederaHealthMonitor(config);
  monitor.startMonitoring();
  return monitor;
};

export default HederaHealthMonitor;