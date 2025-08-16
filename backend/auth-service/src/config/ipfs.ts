import { create, IPFSHTTPClient } from 'ipfs-http-client';
import dotenv from 'dotenv';

dotenv.config();

class IPFSClient {
  private static instance: IPFSClient;
  private client: IPFSHTTPClient;
  private connected: boolean = false;

  private constructor() {
    // IPFS client configuration
    const ipfsUrl = process.env.IPFS_URL || 'http://127.0.0.1:5001';
    const ipfsAuth = process.env.IPFS_AUTH; // Optional: username:password for authentication
    
    const clientOptions: any = {
      url: ipfsUrl,
      timeout: 30000 // 30 seconds timeout
    };

    // Add authentication if provided
    if (ipfsAuth) {
      clientOptions.headers = {
        authorization: `Basic ${Buffer.from(ipfsAuth).toString('base64')}`
      };
    }

    this.client = create(clientOptions);
    console.log(`IPFS client configured for: ${ipfsUrl}`);
  }

  public static getInstance(): IPFSClient {
    if (!IPFSClient.instance) {
      IPFSClient.instance = new IPFSClient();
    }
    return IPFSClient.instance;
  }

  public getClient(): IPFSHTTPClient {
    return this.client;
  }

  /**
   * Test IPFS connection and verify node is running
   */
  public async connect(): Promise<void> {
    try {
      console.log('Testing IPFS connection...');
      
      // Test connection by getting node info
      const version = await this.client.version();
      console.log(`✅ Connected to IPFS node - Version: ${version.version}`);
      
      // Test if we can add a simple test string
      const testContent = 'AfriChain IPFS Connection Test';
      const testFile = await this.client.add(testContent);
      console.log(`✅ IPFS test upload successful - CID: ${testFile.cid.toString()}`);
      
      this.connected = true;
      console.log('🚀 IPFS client initialized successfully');

    } catch (error) {
      console.error('❌ Failed to connect to IPFS node:', error);
      console.error('Please ensure IPFS daemon is running on:', process.env.IPFS_URL || 'http://127.0.0.1:5001');
      throw new Error('IPFS connection failed');
    }
  }

  /**
   * Upload content to IPFS
   */
  public async uploadContent(content: Buffer | Uint8Array | string): Promise<{
    cid: string;
    size: number;
  }> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      const result = await this.client.add(content, {
        pin: true, // Pin the content to prevent garbage collection
        cidVersion: 1, // Use CIDv1 for better compatibility
        hashAlg: 'sha2-256' // Use SHA-256 hash algorithm
      });

      return {
        cid: result.cid.toString(),
        size: result.size
      };

    } catch (error) {
      console.error('IPFS upload error:', error);
      throw error;
    }
  }

  /**
   * Upload multiple files to IPFS
   */
  public async uploadFiles(files: Array<{ path: string; content: Buffer }>): Promise<Array<{
    path: string;
    cid: string;
    size: number;
  }>> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      const results = [];
      
      for await (const result of this.client.addAll(files, {
        pin: true,
        cidVersion: 1,
        hashAlg: 'sha2-256',
        wrapWithDirectory: false
      })) {
        results.push({
          path: result.path,
          cid: result.cid.toString(),
          size: result.size
        });
      }

      return results;

    } catch (error) {
      console.error('IPFS batch upload error:', error);
      throw error;
    }
  }

  /**
   * Retrieve content from IPFS
   */
  public async getContent(cid: string): Promise<Uint8Array> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      const chunks = [];
      
      for await (const chunk of this.client.cat(cid)) {
        chunks.push(chunk);
      }

      // Concatenate all chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;

    } catch (error) {
      console.error('IPFS retrieval error:', error);
      throw error;
    }
  }

  /**
   * Check if content exists and is accessible
   */
  public async contentExists(cid: string): Promise<boolean> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      // Try to get object stats
      const stats = await this.client.object.stat(cid);
      return stats && stats.Hash === cid;

    } catch (error) {
      // Content doesn't exist or isn't accessible
      return false;
    }
  }

  /**
   * Pin content to ensure it's not garbage collected
   */
  public async pinContent(cid: string): Promise<boolean> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      await this.client.pin.add(cid);
      console.log(`📌 Content pinned: ${cid}`);
      return true;

    } catch (error) {
      console.error('IPFS pin error:', error);
      return false;
    }
  }

  /**
   * Unpin content (allow garbage collection)
   */
  public async unpinContent(cid: string): Promise<boolean> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      await this.client.pin.rm(cid);
      console.log(`📌 Content unpinned: ${cid}`);
      return true;

    } catch (error) {
      console.error('IPFS unpin error:', error);
      return false;
    }
  }

  /**
   * Get IPFS node information
   */
  public async getNodeInfo(): Promise<{
    id: string;
    version: string;
    peers: number;
  }> {
    try {
      if (!this.connected) {
        throw new Error('IPFS client not connected');
      }

      const [id, version, swarm] = await Promise.all([
        this.client.id(),
        this.client.version(),
        this.client.swarm.peers()
      ]);

      return {
        id: id.id,
        version: version.version,
        peers: swarm.length
      };

    } catch (error) {
      console.error('IPFS node info error:', error);
      throw error;
    }
  }

  /**
   * Generate IPFS gateway URL for content
   */
  public getGatewayUrl(cid: string): string {
    const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
    return `${gateway}${cid}`;
  }

  /**
   * Disconnect and cleanup
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        // No explicit disconnect method in ipfs-http-client
        // Just mark as disconnected
        this.connected = false;
        console.log('IPFS client disconnected');
      }
    } catch (error) {
      console.error('Error disconnecting IPFS client:', error);
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Health check for IPFS node
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency?: number;
    error?: string;
    nodeInfo?: any;
  }> {
    const startTime = Date.now();
    
    try {
      if (!this.connected) {
        return {
          status: 'unhealthy',
          error: 'IPFS client not connected'
        };
      }

      const nodeInfo = await this.getNodeInfo();
      const latency = Date.now() - startTime;

      return {
        status: 'healthy',
        latency,
        nodeInfo
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export default IPFSClient;