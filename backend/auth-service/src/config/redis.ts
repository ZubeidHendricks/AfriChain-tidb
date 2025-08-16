import { createClient, RedisClientType } from 'redis';

class RedisClient {
  private static instance: RedisClient;
  private client: RedisClientType | null = null;

  private constructor() {}

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  public async connect(): Promise<void> {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD || undefined,
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis successfully');
      });

      await this.client.connect();
    } catch (error) {
      console.error('Error connecting to Redis:', error);
      throw error;
    }
  }

  public getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call connect() first.');
    }
    return this.client;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      console.log('Disconnected from Redis');
    }
  }

  // OTP session management
  public async setOtpSession(sessionId: string, data: any, ttlSeconds: number = 300): Promise<void> {
    const client = this.getClient();
    await client.setEx(`otp:${sessionId}`, ttlSeconds, JSON.stringify(data));
  }

  public async getOtpSession(sessionId: string): Promise<any> {
    const client = this.getClient();
    const data = await client.get(`otp:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  public async deleteOtpSession(sessionId: string): Promise<void> {
    const client = this.getClient();
    await client.del(`otp:${sessionId}`);
  }

  // Rate limiting
  public async incrementRateLimit(phoneHash: string, windowSeconds: number = 900): Promise<number> {
    const client = this.getClient();
    const key = `rate_limit:${phoneHash}`;
    const current = await client.incr(key);
    
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }
    
    return current;
  }

  public async getRateLimit(phoneHash: string): Promise<number> {
    const client = this.getClient();
    const key = `rate_limit:${phoneHash}`;
    const count = await client.get(key);
    return count ? parseInt(count) : 0;
  }

  public async resetRateLimit(phoneHash: string): Promise<void> {
    const client = this.getClient();
    const key = `rate_limit:${phoneHash}`;
    await client.del(key);
  }

  // JWT token blacklisting
  public async blacklistToken(tokenId: string, ttlSeconds: number): Promise<void> {
    const client = this.getClient();
    await client.setEx(`blacklist:${tokenId}`, ttlSeconds, 'blacklisted');
  }

  public async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    const client = this.getClient();
    const result = await client.get(`blacklist:${tokenId}`);
    return result !== null;
  }
}

export default RedisClient;