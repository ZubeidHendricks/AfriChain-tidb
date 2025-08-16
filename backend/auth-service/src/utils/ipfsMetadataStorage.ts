import { NftMetadata } from '../types/nftTypes';
import { generateMetadataHash } from './nftMetadataValidator';
import crypto from 'crypto';
import fetch from 'node-fetch';

/**
 * IPFS Storage Configuration
 */
export interface IpfsConfig {
  pinataApiKey: string;
  pinataSecretKey: string;
  pinataGatewayUrl: string;
  web3StorageToken?: string;
  defaultGateway: 'pinata' | 'web3storage' | 'public';
  useBackupGateways: boolean;
  maxRetries: number;
  retryDelay: number; // milliseconds
}

/**
 * IPFS Storage Result
 */
export interface IpfsStorageResult {
  success: boolean;
  ipfsHash: string;
  gatewayUrl: string;
  metadataHash: string;
  uploadedAt: Date;
  size: number;
  error?: string;
}

/**
 * IPFS Retrieval Result
 */
export interface IpfsRetrievalResult {
  success: boolean;
  metadata?: NftMetadata;
  ipfsHash: string;
  isValid: boolean;
  retrievedAt: Date;
  error?: string;
}

/**
 * IPFS Gateway Status
 */
export interface GatewayStatus {
  gateway: string;
  url: string;
  isAvailable: boolean;
  latency: number; // milliseconds
  lastCheck: Date;
  error?: string;
}

/**
 * IPFS Metadata Storage Service
 * Handles uploading and retrieving NFT metadata from IPFS
 */
export class IpfsMetadataStorage {
  private config: IpfsConfig;
  private gatewayHealth: Map<string, GatewayStatus> = new Map();
  private retryQueue: Array<{ metadata: NftMetadata; retries: number }> = [];

  constructor(config: Partial<IpfsConfig> = {}) {
    this.config = {
      pinataApiKey: process.env.PINATA_API_KEY || '',
      pinataSecretKey: process.env.PINATA_SECRET_KEY || '',
      pinataGatewayUrl: 'https://gateway.pinata.cloud/ipfs/',
      web3StorageToken: process.env.WEB3_STORAGE_TOKEN || '',
      defaultGateway: 'pinata',
      useBackupGateways: true,
      maxRetries: 3,
      retryDelay: 2000,
      ...config
    };

    this.initializeGatewayHealth();
  }

  /**
   * Store NFT metadata on IPFS
   */
  async storeMetadata(metadata: NftMetadata, options: {
    pinName?: string;
    retryOnFailure?: boolean;
  } = {}): Promise<IpfsStorageResult> {
    try {
      console.log('📁 Storing NFT metadata on IPFS...');

      // Generate metadata hash for verification
      const metadataHash = generateMetadataHash(metadata);
      const metadataString = JSON.stringify(metadata, null, 2);
      const size = Buffer.byteLength(metadataString, 'utf8');

      // Try primary gateway first
      let result = await this.uploadToPrimaryGateway(
        metadata, 
        metadataString, 
        options.pinName || `NFT-Metadata-${Date.now()}`
      );

      // Try backup gateways if primary fails
      if (!result.success && this.config.useBackupGateways) {
        console.log('⚠️ Primary gateway failed, trying backup gateways...');
        result = await this.uploadToBackupGateways(metadata, metadataString, options.pinName);
      }

      // Add to retry queue if all attempts failed and retry is enabled
      if (!result.success && options.retryOnFailure) {
        this.addToRetryQueue(metadata);
      }

      if (result.success) {
        console.log(`✅ Metadata stored on IPFS: ${result.ipfsHash}`);
      } else {
        console.error('❌ Failed to store metadata on IPFS');
      }

      return {
        ...result,
        metadataHash,
        uploadedAt: new Date(),
        size
      };

    } catch (error) {
      console.error('❌ IPFS storage error:', error);
      return {
        success: false,
        ipfsHash: '',
        gatewayUrl: '',
        metadataHash: generateMetadataHash(metadata),
        uploadedAt: new Date(),
        size: 0,
        error: error instanceof Error ? error.message : 'IPFS storage failed'
      };
    }
  }

  /**
   * Retrieve NFT metadata from IPFS
   */
  async retrieveMetadata(ipfsHash: string, options: {
    validateHash?: string;
    useBackupGateways?: boolean;
  } = {}): Promise<IpfsRetrievalResult> {
    try {
      console.log(`📥 Retrieving metadata from IPFS: ${ipfsHash}`);

      // Try primary gateway first
      let result = await this.downloadFromGateway(
        this.getPrimaryGatewayUrl(ipfsHash),
        ipfsHash
      );

      // Try backup gateways if primary fails
      if (!result.success && (options.useBackupGateways ?? this.config.useBackupGateways)) {
        result = await this.downloadFromBackupGateways(ipfsHash);
      }

      if (result.success && result.metadata) {
        // Validate hash if provided
        let isValid = true;
        if (options.validateHash) {
          const actualHash = generateMetadataHash(result.metadata);
          isValid = actualHash === options.validateHash;
          
          if (!isValid) {
            console.warn('⚠️ Metadata hash validation failed');
          }
        }

        console.log(`✅ Metadata retrieved from IPFS: ${ipfsHash}`);
        return {
          ...result,
          isValid
        };
      }

      console.error(`❌ Failed to retrieve metadata from IPFS: ${ipfsHash}`);
      return result;

    } catch (error) {
      console.error('❌ IPFS retrieval error:', error);
      return {
        success: false,
        ipfsHash,
        isValid: false,
        retrievedAt: new Date(),
        error: error instanceof Error ? error.message : 'IPFS retrieval failed'
      };
    }
  }

  /**
   * Upload to Pinata (primary gateway)
   */
  private async uploadToPrimaryGateway(
    metadata: NftMetadata,
    metadataString: string,
    pinName: string
  ): Promise<Omit<IpfsStorageResult, 'metadataHash' | 'uploadedAt' | 'size'>> {
    if (this.config.defaultGateway === 'pinata' && this.config.pinataApiKey) {
      return await this.uploadToPinata(metadataString, pinName);
    }

    if (this.config.defaultGateway === 'web3storage' && this.config.web3StorageToken) {
      return await this.uploadToWeb3Storage(metadataString, pinName);
    }

    return {
      success: false,
      ipfsHash: '',
      gatewayUrl: '',
      error: 'No valid primary gateway configured'
    };
  }

  /**
   * Upload to Pinata IPFS service
   */
  private async uploadToPinata(
    metadataString: string,
    pinName: string
  ): Promise<Omit<IpfsStorageResult, 'metadataHash' | 'uploadedAt' | 'size'>> {
    try {
      const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
      
      const body = {
        pinataContent: JSON.parse(metadataString),
        pinataMetadata: {
          name: pinName,
          keyvalues: {
            project: 'AfriChain',
            type: 'NFT-Metadata',
            timestamp: new Date().toISOString()
          }
        },
        pinataOptions: {
          cidVersion: 1
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': this.config.pinataApiKey,
          'pinata_secret_api_key': this.config.pinataSecretKey
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Pinata upload failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;
      const ipfsHash = result.IpfsHash;
      const gatewayUrl = `${this.config.pinataGatewayUrl}${ipfsHash}`;

      return {
        success: true,
        ipfsHash,
        gatewayUrl
      };

    } catch (error) {
      console.error('❌ Pinata upload failed:', error);
      return {
        success: false,
        ipfsHash: '',
        gatewayUrl: '',
        error: error instanceof Error ? error.message : 'Pinata upload failed'
      };
    }
  }

  /**
   * Upload to Web3.Storage
   */
  private async uploadToWeb3Storage(
    metadataString: string,
    pinName: string
  ): Promise<Omit<IpfsStorageResult, 'metadataHash' | 'uploadedAt' | 'size'>> {
    try {
      // Web3.Storage implementation would go here
      // For now, return a placeholder
      return {
        success: false,
        ipfsHash: '',
        gatewayUrl: '',
        error: 'Web3.Storage integration not implemented yet'
      };

    } catch (error) {
      console.error('❌ Web3.Storage upload failed:', error);
      return {
        success: false,
        ipfsHash: '',
        gatewayUrl: '',
        error: error instanceof Error ? error.message : 'Web3.Storage upload failed'
      };
    }
  }

  /**
   * Try backup gateways for upload
   */
  private async uploadToBackupGateways(
    metadata: NftMetadata,
    metadataString: string,
    pinName?: string
  ): Promise<Omit<IpfsStorageResult, 'metadataHash' | 'uploadedAt' | 'size'>> {
    const backupMethods = [];

    // Add available backup methods
    if (this.config.defaultGateway !== 'pinata' && this.config.pinataApiKey) {
      backupMethods.push(() => this.uploadToPinata(metadataString, pinName || 'backup-upload'));
    }

    if (this.config.defaultGateway !== 'web3storage' && this.config.web3StorageToken) {
      backupMethods.push(() => this.uploadToWeb3Storage(metadataString, pinName || 'backup-upload'));
    }

    for (const method of backupMethods) {
      try {
        const result = await method();
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.warn('⚠️ Backup gateway failed:', error);
      }
    }

    return {
      success: false,
      ipfsHash: '',
      gatewayUrl: '',
      error: 'All backup gateways failed'
    };
  }

  /**
   * Download metadata from specific gateway
   */
  private async downloadFromGateway(
    gatewayUrl: string,
    ipfsHash: string
  ): Promise<IpfsRetrievalResult> {
    try {
      const startTime = Date.now();
      const response = await fetch(gatewayUrl, {
        timeout: 10000, // 10-second timeout
        headers: {
          'Accept': 'application/json'
        }
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`Gateway responded with ${response.status}: ${response.statusText}`);
      }

      const metadata = await response.json() as NftMetadata;

      // Update gateway health
      this.updateGatewayHealth(gatewayUrl, true, latency);

      return {
        success: true,
        metadata,
        ipfsHash,
        isValid: true,
        retrievedAt: new Date()
      };

    } catch (error) {
      // Update gateway health
      this.updateGatewayHealth(gatewayUrl, false, -1, error);

      return {
        success: false,
        ipfsHash,
        isValid: false,
        retrievedAt: new Date(),
        error: error instanceof Error ? error.message : 'Gateway download failed'
      };
    }
  }

  /**
   * Try backup gateways for download
   */
  private async downloadFromBackupGateways(ipfsHash: string): Promise<IpfsRetrievalResult> {
    const backupGateways = [
      `https://ipfs.io/ipfs/${ipfsHash}`,
      `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
      `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
      `https://dweb.link/ipfs/${ipfsHash}`
    ];

    for (const gatewayUrl of backupGateways) {
      try {
        const result = await this.downloadFromGateway(gatewayUrl, ipfsHash);
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.warn(`⚠️ Backup gateway failed: ${gatewayUrl}`, error);
      }
    }

    return {
      success: false,
      ipfsHash,
      isValid: false,
      retrievedAt: new Date(),
      error: 'All backup gateways failed'
    };
  }

  /**
   * Get primary gateway URL for hash
   */
  private getPrimaryGatewayUrl(ipfsHash: string): string {
    switch (this.config.defaultGateway) {
      case 'pinata':
        return `${this.config.pinataGatewayUrl}${ipfsHash}`;
      case 'web3storage':
        return `https://${ipfsHash}.ipfs.w3s.link`;
      case 'public':
      default:
        return `https://ipfs.io/ipfs/${ipfsHash}`;
    }
  }

  /**
   * Initialize gateway health monitoring
   */
  private initializeGatewayHealth(): void {
    const gateways = [
      { name: 'pinata', url: this.config.pinataGatewayUrl },
      { name: 'ipfs.io', url: 'https://ipfs.io/ipfs/' },
      { name: 'cloudflare', url: 'https://cloudflare-ipfs.com/ipfs/' }
    ];

    gateways.forEach(gateway => {
      this.gatewayHealth.set(gateway.name, {
        gateway: gateway.name,
        url: gateway.url,
        isAvailable: true,
        latency: 0,
        lastCheck: new Date()
      });
    });
  }

  /**
   * Update gateway health status
   */
  private updateGatewayHealth(
    gatewayUrl: string,
    isAvailable: boolean,
    latency: number,
    error?: any
  ): void {
    const gatewayName = this.getGatewayNameFromUrl(gatewayUrl);
    
    this.gatewayHealth.set(gatewayName, {
      gateway: gatewayName,
      url: gatewayUrl,
      isAvailable,
      latency,
      lastCheck: new Date(),
      error: error instanceof Error ? error.message : undefined
    });
  }

  /**
   * Get gateway name from URL
   */
  private getGatewayNameFromUrl(url: string): string {
    if (url.includes('pinata.cloud')) return 'pinata';
    if (url.includes('ipfs.io')) return 'ipfs.io';
    if (url.includes('cloudflare-ipfs.com')) return 'cloudflare';
    if (url.includes('w3s.link')) return 'web3storage';
    return 'unknown';
  }

  /**
   * Add metadata to retry queue
   */
  private addToRetryQueue(metadata: NftMetadata): void {
    this.retryQueue.push({ metadata, retries: 0 });
    console.log(`📋 Added metadata to retry queue (${this.retryQueue.length} items)`);
  }

  /**
   * Process retry queue
   */
  async processRetryQueue(): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    if (this.retryQueue.length === 0) {
      return { processed: 0, successful: 0, failed: 0 };
    }

    console.log(`🔄 Processing retry queue (${this.retryQueue.length} items)...`);

    let processed = 0;
    let successful = 0;
    let failed = 0;

    while (this.retryQueue.length > 0) {
      const item = this.retryQueue.shift()!;
      processed++;

      try {
        const result = await this.storeMetadata(item.metadata, { retryOnFailure: false });
        
        if (result.success) {
          successful++;
        } else {
          item.retries++;
          if (item.retries < this.config.maxRetries) {
            this.retryQueue.push(item);
          } else {
            failed++;
          }
        }
      } catch (error) {
        console.error('❌ Retry queue processing error:', error);
        failed++;
      }

      // Add delay between retries
      if (this.retryQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      }
    }

    console.log(`✅ Retry queue processed: ${successful} successful, ${failed} failed`);
    return { processed, successful, failed };
  }

  /**
   * Get gateway health status
   */
  getGatewayHealth(): GatewayStatus[] {
    return Array.from(this.gatewayHealth.values());
  }

  /**
   * Test gateway connectivity
   */
  async testGatewayConnectivity(): Promise<GatewayStatus[]> {
    const testHash = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'; // Hello World test file
    const gateways = Array.from(this.gatewayHealth.keys());

    const results = await Promise.allSettled(
      gateways.map(async (gatewayName) => {
        const gateway = this.gatewayHealth.get(gatewayName)!;
        const testUrl = `${gateway.url}${testHash}`;

        try {
          const startTime = Date.now();
          const response = await fetch(testUrl, {
            method: 'HEAD',
            timeout: 5000
          });
          const latency = Date.now() - startTime;

          const status: GatewayStatus = {
            gateway: gatewayName,
            url: gateway.url,
            isAvailable: response.ok,
            latency,
            lastCheck: new Date()
          };

          this.gatewayHealth.set(gatewayName, status);
          return status;

        } catch (error) {
          const status: GatewayStatus = {
            gateway: gatewayName,
            url: gateway.url,
            isAvailable: false,
            latency: -1,
            lastCheck: new Date(),
            error: error instanceof Error ? error.message : 'Connection test failed'
          };

          this.gatewayHealth.set(gatewayName, status);
          return status;
        }
      })
    );

    return results
      .filter(result => result.status === 'fulfilled')
      .map(result => (result as PromiseFulfilledResult<GatewayStatus>).value);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<IpfsConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ IPFS configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): IpfsConfig {
    return { ...this.config };
  }
}

// Create singleton instance
let ipfsStorage: IpfsMetadataStorage | null = null;

/**
 * Get singleton IPFS storage instance
 */
export const getIpfsMetadataStorage = (config?: Partial<IpfsConfig>): IpfsMetadataStorage => {
  if (!ipfsStorage) {
    ipfsStorage = new IpfsMetadataStorage(config);
  }
  return ipfsStorage;
};

/**
 * Store metadata on IPFS with default configuration
 */
export const storeMetadataOnIpfs = async (metadata: NftMetadata): Promise<IpfsStorageResult> => {
  const storage = getIpfsMetadataStorage();
  return await storage.storeMetadata(metadata);
};

/**
 * Retrieve metadata from IPFS with default configuration
 */
export const retrieveMetadataFromIpfs = async (ipfsHash: string): Promise<IpfsRetrievalResult> => {
  const storage = getIpfsMetadataStorage();
  return await storage.retrieveMetadata(ipfsHash);
};

export default IpfsMetadataStorage;