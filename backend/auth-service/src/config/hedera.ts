import { Client, PrivateKey, AccountId, Hbar } from '@hashgraph/sdk';

/**
 * Hedera Network Configuration
 */
export interface HederaConfig {
  networkType: 'testnet' | 'mainnet';
  operatorId: string;
  operatorKey: string;
  treasuryId: string;
  treasuryKey: string;
  maxTransactionFee: number;
  maxQueryPayment: number;
  defaultTransactionMemo: string;
}

/**
 * Hedera Client Health Status
 */
export interface HederaHealthStatus {
  status: 'healthy' | 'unhealthy' | 'connecting';
  networkType: string;
  operatorAccount: string;
  treasuryAccount: string;
  operatorBalance?: string;
  treasuryBalance?: string;
  lastSuccessfulConnection?: Date;
  error?: string;
}

/**
 * Load Hedera configuration from environment variables
 */
export const loadHederaConfig = (): HederaConfig => {
  const config: HederaConfig = {
    networkType: (process.env.HEDERA_NETWORK || 'testnet') as 'testnet' | 'mainnet',
    operatorId: process.env.HEDERA_OPERATOR_ID || '',
    operatorKey: process.env.HEDERA_OPERATOR_KEY || '',
    treasuryId: process.env.HEDERA_TREASURY_ID || process.env.HEDERA_OPERATOR_ID || '',
    treasuryKey: process.env.HEDERA_TREASURY_KEY || process.env.HEDERA_OPERATOR_KEY || '',
    maxTransactionFee: parseInt(process.env.HEDERA_MAX_TRANSACTION_FEE || '100'),
    maxQueryPayment: parseInt(process.env.HEDERA_MAX_QUERY_PAYMENT || '10'),
    defaultTransactionMemo: process.env.HEDERA_TRANSACTION_MEMO || 'AfriChain NFT Operation'
  };

  // Validation
  if (!config.operatorId) {
    throw new Error('HEDERA_OPERATOR_ID environment variable is required');
  }
  if (!config.operatorKey) {
    throw new Error('HEDERA_OPERATOR_KEY environment variable is required');
  }

  return config;
};

/**
 * Hedera Client Manager
 * Handles connection, configuration, and health monitoring
 */
export class HederaClientManager {
  private client: Client | null = null;
  private config: HederaConfig;
  private lastHealthCheck: Date | null = null;
  private healthStatus: HederaHealthStatus;

  constructor() {
    this.config = loadHederaConfig();
    this.healthStatus = {
      status: 'connecting',
      networkType: this.config.networkType,
      operatorAccount: this.config.operatorId,
      treasuryAccount: this.config.treasuryId
    };
  }

  /**
   * Initialize and configure Hedera client
   */
  async initializeClient(): Promise<Client> {
    try {
      console.log(`🔗 Initializing Hedera client for ${this.config.networkType}...`);

      // Create client based on network type
      if (this.config.networkType === 'mainnet') {
        this.client = Client.forMainnet();
      } else {
        this.client = Client.forTestnet();
      }

      // Set operator account and private key
      const operatorKey = PrivateKey.fromString(this.config.operatorKey);
      const operatorId = AccountId.fromString(this.config.operatorId);

      this.client.setOperator(operatorId, operatorKey);

      // Set transaction fees and payment limits
      this.client.setDefaultMaxTransactionFee(new Hbar(this.config.maxTransactionFee));
      this.client.setDefaultMaxQueryPayment(new Hbar(this.config.maxQueryPayment));

      // Set default transaction memo
      this.client.setDefaultTransactionMemo(this.config.defaultTransactionMemo);

      console.log(`✅ Hedera client initialized successfully`);
      console.log(`   Network: ${this.config.networkType}`);
      console.log(`   Operator: ${this.config.operatorId}`);
      console.log(`   Treasury: ${this.config.treasuryId}`);

      // Perform initial health check
      await this.performHealthCheck();

      return this.client;
    } catch (error) {
      console.error('❌ Failed to initialize Hedera client:', error);
      this.healthStatus = {
        ...this.healthStatus,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      throw error;
    }
  }

  /**
   * Get or create Hedera client instance
   */
  async getClient(): Promise<Client> {
    if (!this.client) {
      return await this.initializeClient();
    }
    return this.client;
  }

  /**
   * Get treasury private key for minting operations
   */
  getTreasuryKey(): PrivateKey {
    return PrivateKey.fromString(this.config.treasuryKey);
  }

  /**
   * Get treasury account ID
   */
  getTreasuryId(): AccountId {
    return AccountId.fromString(this.config.treasuryId);
  }

  /**
   * Get operator account ID
   */
  getOperatorId(): AccountId {
    return AccountId.fromString(this.config.operatorId);
  }

  /**
   * Get configuration
   */
  getConfig(): HederaConfig {
    return this.config;
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HederaHealthStatus> {
    try {
      const client = await this.getClient();
      
      console.log('🔍 Performing Hedera network health check...');

      // Check operator account balance
      const operatorBalance = await client.getAccountBalance(
        AccountId.fromString(this.config.operatorId)
      );

      // Check treasury account balance (if different from operator)
      let treasuryBalance = operatorBalance;
      if (this.config.treasuryId !== this.config.operatorId) {
        treasuryBalance = await client.getAccountBalance(
          AccountId.fromString(this.config.treasuryId)
        );
      }

      this.healthStatus = {
        status: 'healthy',
        networkType: this.config.networkType,
        operatorAccount: this.config.operatorId,
        treasuryAccount: this.config.treasuryId,
        operatorBalance: operatorBalance.hbars.toString(),
        treasuryBalance: treasuryBalance.hbars.toString(),
        lastSuccessfulConnection: new Date(),
        error: undefined
      };

      this.lastHealthCheck = new Date();

      console.log('✅ Hedera health check successful');
      console.log(`   Operator Balance: ${operatorBalance.hbars.toString()}`);
      console.log(`   Treasury Balance: ${treasuryBalance.hbars.toString()}`);

      return this.healthStatus;

    } catch (error) {
      console.error('❌ Hedera health check failed:', error);
      
      this.healthStatus = {
        ...this.healthStatus,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Health check failed'
      };

      return this.healthStatus;
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HederaHealthStatus {
    return this.healthStatus;
  }

  /**
   * Get health status with automatic refresh if stale
   */
  async getHealthStatusWithRefresh(maxAge: number = 5 * 60 * 1000): Promise<HederaHealthStatus> {
    const now = new Date();
    if (!this.lastHealthCheck || (now.getTime() - this.lastHealthCheck.getTime()) > maxAge) {
      return await this.performHealthCheck();
    }
    return this.healthStatus;
  }

  /**
   * Estimate transaction fees for operations
   */
  async estimateTransactionFee(operationType: 'mint' | 'transfer' | 'associate'): Promise<Hbar> {
    const baseFees = {
      mint: new Hbar(20), // Approximate fee for NFT minting
      transfer: new Hbar(1), // Approximate fee for NFT transfer
      associate: new Hbar(5) // Approximate fee for token association
    };

    // In a production environment, you might want to query actual network fees
    // For now, we return estimated fees based on operation type
    return baseFees[operationType];
  }

  /**
   * Validate account ID format
   */
  static isValidAccountId(accountId: string): boolean {
    try {
      AccountId.fromString(accountId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate private key format
   */
  static isValidPrivateKey(privateKey: string): boolean {
    try {
      PrivateKey.fromString(privateKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format HBAR amount for display
   */
  static formatHbarAmount(hbarAmount: Hbar): string {
    return `${hbarAmount.toString()} HBAR`;
  }

  /**
   * Convert HBAR to tinybars (smallest unit)
   */
  static hbarToTinybars(hbar: Hbar): number {
    return hbar.toTinybars().toNumber();
  }

  /**
   * Close client connection gracefully
   */
  async close(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
      console.log('🔌 Hedera client connection closed');
    }
  }
}

// Create singleton instance
let hederaClientManager: HederaClientManager | null = null;

/**
 * Get singleton Hedera client manager instance
 */
export const getHederaClientManager = (): HederaClientManager => {
  if (!hederaClientManager) {
    hederaClientManager = new HederaClientManager();
  }
  return hederaClientManager;
};

/**
 * Initialize Hedera integration
 * Should be called during application startup
 */
export const initializeHedera = async (): Promise<HederaClientManager> => {
  const manager = getHederaClientManager();
  await manager.initializeClient();
  return manager;
};

export default HederaClientManager;