import mysql from 'mysql2/promise';
import { createConnection } from 'mysql2/promise';
import ProductModel from '../models/Product';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    rejectUnauthorized: boolean;
  };
}

class Database {
  private static instance: Database;
  private connection: mysql.Connection | null = null;

  private constructor() {}

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async connect(): Promise<void> {
    try {
      const config: DatabaseConfig = {
        host: process.env.TIDB_HOST || 'localhost',
        port: parseInt(process.env.TIDB_PORT || '4000'),
        user: process.env.TIDB_USER || 'root',
        password: process.env.TIDB_PASSWORD || '',
        database: process.env.TIDB_DATABASE || 'africhain_auth',
        ssl: process.env.TIDB_SSL_ENABLED === 'true' ? {
          rejectUnauthorized: false
        } : undefined
      };

      this.connection = await createConnection(config);
      console.log('Connected to TiDB successfully');
    } catch (error) {
      console.error('Error connecting to TiDB:', error);
      throw error;
    }
  }

  public getConnection(): mysql.Connection {
    if (!this.connection) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.connection;
  }

  public async getConnectionAsync(): Promise<mysql.Connection> {
    if (!this.connection) {
      await this.connect();
    }
    return this.connection!;
  }

  public async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      console.log('Disconnected from TiDB');
    }
  }

  public async initializeTables(): Promise<void> {
    const connection = await this.getConnectionAsync();
    
    // Create users table with encrypted phone number storage
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        phone_number_hash VARCHAR(64) NOT NULL UNIQUE,
        encrypted_phone TEXT NOT NULL,
        verification_status ENUM('pending', 'verified', 'suspended') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL,
        INDEX idx_phone_hash (phone_number_hash),
        INDEX idx_verification_status (verification_status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    // Create OTP sessions table
    const createOtpSessionsTable = `
      CREATE TABLE IF NOT EXISTS otp_sessions (
        id VARCHAR(36) PRIMARY KEY,
        phone_number_hash VARCHAR(64) NOT NULL,
        otp_hash VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INT DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_phone_hash (phone_number_hash),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    // Create rate limiting table
    const createRateLimitTable = `
      CREATE TABLE IF NOT EXISTS rate_limits (
        id VARCHAR(36) PRIMARY KEY,
        phone_number_hash VARCHAR(64) NOT NULL,
        request_count INT DEFAULT 1,
        window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_phone_hash (phone_number_hash),
        INDEX idx_window_start (window_start)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    try {
      await connection.execute(createUsersTable);
      await connection.execute(createOtpSessionsTable);
      await connection.execute(createRateLimitTable);
      
      // Initialize product-related tables
      const productModel = new ProductModel();
      await productModel.initializeTables();
      
      console.log('Database tables created successfully');
    } catch (error) {
      console.error('Error creating database tables:', error);
      throw error;
    }
  }
}

export default Database;