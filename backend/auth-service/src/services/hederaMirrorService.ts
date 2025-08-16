/**
 * Hedera Mirror Node Service for blockchain verification
 * 
 * This service provides integration with the Hedera Mirror Node API
 * to verify NFT tokens and retrieve blockchain state information.
 */

import { createHash } from 'crypto';

export interface HederaNFTInfo {
  token_id: string;
  serial_number: number;
  account_id: string;
  created_timestamp: string;
  modified_timestamp: string;
  metadata?: string;
  deleted?: boolean;
}

export interface HederaTokenInfo {
  token_id: string;
  symbol: string;
  name: string;
  type: string;
  supply_type: string;
  initial_supply: string;
  total_supply: string;
  treasury_account_id: string;
  created_timestamp: string;
  modified_timestamp: string;
  deleted?: boolean;
  metadata?: string;
}

export interface HederaTransactionInfo {
  transaction_id: string;
  consensus_timestamp: string;
  valid_start_timestamp: string;
  charged_tx_fee: number;
  max_fee: string;
  memo_base64?: string;
  name: string;
  result: string;
  scheduled?: boolean;
  transaction_hash: string;
  transfers?: Array<{
    account: string;
    amount: number;
    token_id?: string;
  }>;
  nft_transfers?: Array<{
    token_id: string;
    serial_number: number;
    sender_account_id: string;
    receiver_account_id: string;
    is_approval?: boolean;
  }>;
}

export interface BlockchainVerificationResult {
  exists: boolean;
  isValid: boolean;
  nftInfo?: HederaNFTInfo;
  tokenInfo?: HederaTokenInfo;
  transactionHistory?: HederaTransactionInfo[];
  verificationTimestamp: string;
  errors: string[];
  warnings: string[];
}

export class HederaMirrorService {
  private baseUrl: string;
  private timeout: number;
  private retryAttempts: number;
  private rateLimitDelay: number;

  constructor(
    network: 'mainnet' | 'testnet' | 'previewnet' = 'testnet',
    timeout = 10000,
    retryAttempts = 3,
    rateLimitDelay = 1000
  ) {
    this.baseUrl = this.getNetworkUrl(network);
    this.timeout = timeout;
    this.retryAttempts = retryAttempts;
    this.rateLimitDelay = rateLimitDelay;
  }

  /**
   * Get the appropriate Mirror Node URL for the network
   */
  private getNetworkUrl(network: 'mainnet' | 'testnet' | 'previewnet'): string {
    switch (network) {
      case 'mainnet':
        return 'https://mainnet-public.mirrornode.hedera.com';
      case 'testnet':
        return 'https://testnet.mirrornode.hedera.com';
      case 'previewnet':
        return 'https://previewnet.mirrornode.hedera.com';
      default:
        return 'https://testnet.mirrornode.hedera.com';
    }
  }

  /**
   * Make HTTP request with retry logic and rate limiting
   */
  private async makeRequest<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // Rate limiting delay between requests
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay * attempt));
        }

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'AfriChain-Authenticity-Verifier/1.0',
          },
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited, wait longer
            await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay * 2));
            continue;
          }
          
          if (response.status === 404) {
            throw new Error(`Resource not found: ${endpoint}`);
          }

          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === this.retryAttempts) {
          throw new Error(`Failed after ${this.retryAttempts} attempts: ${lastError.message}`);
        }
      }
    }

    throw lastError || new Error('Request failed');
  }

  /**
   * Get NFT token information by token ID and serial number
   */
  async getNFTInfo(tokenId: string, serialNumber: number): Promise<HederaNFTInfo | null> {
    try {
      const response = await this.makeRequest<{ nfts: HederaNFTInfo[] }>(
        `/tokens/${tokenId}/nfts/${serialNumber}`
      );

      return response.nfts?.[0] || null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get token information by token ID
   */
  async getTokenInfo(tokenId: string): Promise<HederaTokenInfo | null> {
    try {
      const response = await this.makeRequest<HederaTokenInfo>(`/tokens/${tokenId}`);
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get transaction history for a specific NFT
   */
  async getNFTTransactionHistory(
    tokenId: string, 
    serialNumber: number, 
    limit = 10
  ): Promise<HederaTransactionInfo[]> {
    try {
      const response = await this.makeRequest<{ transactions: HederaTransactionInfo[] }>(
        `/tokens/${tokenId}/nfts/${serialNumber}/transactions`,
        { limit: limit.toString() }
      );

      return response.transactions || [];
    } catch (error) {
      console.error('Failed to get NFT transaction history:', error);
      return [];
    }
  }

  /**
   * Get all NFTs for a specific account
   */
  async getAccountNFTs(accountId: string, tokenId?: string): Promise<HederaNFTInfo[]> {
    try {
      const params: Record<string, string> = {};
      if (tokenId) {
        params['token.id'] = tokenId;
      }

      const response = await this.makeRequest<{ nfts: HederaNFTInfo[] }>(
        `/accounts/${accountId}/nfts`,
        params
      );

      return response.nfts || [];
    } catch (error) {
      console.error('Failed to get account NFTs:', error);
      return [];
    }
  }

  /**
   * Verify NFT metadata hash against blockchain record
   */
  async verifyMetadataHash(
    tokenId: string, 
    serialNumber: number, 
    expectedHash: string
  ): Promise<boolean> {
    try {
      const nftInfo = await this.getNFTInfo(tokenId, serialNumber);
      if (!nftInfo || !nftInfo.metadata) {
        return false;
      }

      // Decode base64 metadata if needed
      let metadataString = nftInfo.metadata;
      try {
        // Try to decode as base64 first
        metadataString = Buffer.from(nftInfo.metadata, 'base64').toString('utf-8');
      } catch {
        // If base64 decode fails, use as-is
      }

      // Calculate hash of metadata
      const actualHash = createHash('sha256').update(metadataString).digest('hex');
      return actualHash === expectedHash;
    } catch (error) {
      console.error('Failed to verify metadata hash:', error);
      return false;
    }
  }

  /**
   * Comprehensive blockchain verification for a product NFT
   */
  async verifyProductNFT(
    tokenId: string,
    serialNumber: number,
    expectedOwner?: string,
    expectedMetadataHash?: string
  ): Promise<BlockchainVerificationResult> {
    const result: BlockchainVerificationResult = {
      exists: false,
      isValid: true,
      verificationTimestamp: new Date().toISOString(),
      errors: [],
      warnings: [],
    };

    try {
      // Get NFT information
      const nftInfo = await this.getNFTInfo(tokenId, serialNumber);
      if (!nftInfo) {
        result.errors.push('NFT does not exist on the blockchain');
        return result;
      }

      result.exists = true;
      result.nftInfo = nftInfo;

      // Check if NFT is deleted
      if (nftInfo.deleted) {
        result.isValid = false;
        result.errors.push('NFT has been deleted from the blockchain');
      }

      // Get token information
      try {
        const tokenInfo = await getTokenInfo(tokenId);
        if (tokenInfo) {
          result.tokenInfo = tokenInfo;
          
          if (tokenInfo.deleted) {
            result.isValid = false;
            result.errors.push('Token has been deleted from the blockchain');
          }
        }
      } catch (error) {
        result.warnings.push('Could not retrieve token information');
      }

      // Verify expected owner if provided
      if (expectedOwner && nftInfo.account_id !== expectedOwner) {
        result.warnings.push(`NFT owner mismatch. Expected: ${expectedOwner}, Actual: ${nftInfo.account_id}`);
      }

      // Verify metadata hash if provided
      if (expectedMetadataHash) {
        const metadataValid = await this.verifyMetadataHash(tokenId, serialNumber, expectedMetadataHash);
        if (!metadataValid) {
          result.isValid = false;
          result.errors.push('Metadata hash verification failed');
        }
      }

      // Get transaction history
      try {
        const transactions = await this.getNFTTransactionHistory(tokenId, serialNumber, 5);
        result.transactionHistory = transactions;
      } catch (error) {
        result.warnings.push('Could not retrieve transaction history');
      }

    } catch (error) {
      result.isValid = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown verification error');
    }

    return result;
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: string }> {
    try {
      const startTime = Date.now();
      await this.makeRequest('/network/nodes', { limit: '1' });
      const responseTime = Date.now() - startTime;

      if (responseTime < 2000) {
        return { status: 'healthy', details: `Response time: ${responseTime}ms` };
      } else if (responseTime < 5000) {
        return { status: 'degraded', details: `Slow response time: ${responseTime}ms` };
      } else {
        return { status: 'unhealthy', details: `Very slow response time: ${responseTime}ms` };
      }
    } catch (error) {
      return { 
        status: 'unhealthy', 
        details: error instanceof Error ? error.message : 'Health check failed' 
      };
    }
  }
}

// Create default instances for different networks
export const testnetMirrorService = new HederaMirrorService('testnet');
export const mainnetMirrorService = new HederaMirrorService('mainnet');

// Helper function to get the appropriate service based on environment
export function getMirrorService(network?: string): HederaMirrorService {
  switch (network?.toLowerCase()) {
    case 'mainnet':
    case 'production':
      return mainnetMirrorService;
    case 'testnet':
    case 'development':
    default:
      return testnetMirrorService;
  }
}

// Fix reference error
function getTokenInfo(tokenId: string): Promise<HederaTokenInfo | null> {
  const service = getMirrorService();
  return service.getTokenInfo(tokenId);
}