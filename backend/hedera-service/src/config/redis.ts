import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType;

export async function connectRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379/0';
  
  redisClient = createClient({
    url: redisUrl,
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('Redis Client Connected');
  });

  await redisClient.connect();
}

export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
}

export async function publishToChannel(channel: string, message: any): Promise<void> {
  const client = getRedisClient();
  await client.publish(channel, JSON.stringify(message));
}

export async function subscribeToChannel(channel: string, callback: (message: string) => void): Promise<void> {
  const client = getRedisClient();
  await client.subscribe(channel, callback);
}