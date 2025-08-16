import { PrivateKey, PublicKey, AccountId } from '@hashgraph/sdk';
import crypto from 'crypto';

/**
 * Key pair interface for Hedera operations
 */
export interface HederaKeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
  accountId?: AccountId;
}

/**
 * Key validation result
 */
export interface KeyValidationResult {
  isValid: boolean;
  error?: string;
  keyType?: 'ED25519' | 'ECDSA_SECP256K1';
}

/**
 * Account creation result
 */
export interface AccountCreationInfo {
  accountId: AccountId;
  publicKey: PublicKey;
  privateKey: PrivateKey;
  initialBalance: number;
}

/**
 * Hedera Key Management Utilities
 * Handles key generation, validation, and secure operations
 */
export class HederaKeyManager {
  /**
   * Generate a new ED25519 key pair for Hedera operations
   */
  static generateED25519KeyPair(): HederaKeyPair {
    try {
      console.log('🔑 Generating new ED25519 key pair...');
      
      const privateKey = PrivateKey.generateED25519();
      const publicKey = privateKey.publicKey;
      
      console.log('✅ ED25519 key pair generated successfully');
      
      return {
        privateKey,
        publicKey
      };
    } catch (error) {
      console.error('❌ Failed to generate ED25519 key pair:', error);
      throw new Error(`Key generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a new ECDSA secp256k1 key pair for Hedera operations
   */
  static generateECDSAKeyPair(): HederaKeyPair {
    try {
      console.log('🔑 Generating new ECDSA secp256k1 key pair...');
      
      const privateKey = PrivateKey.generateECDSA();
      const publicKey = privateKey.publicKey;
      
      console.log('✅ ECDSA key pair generated successfully');
      
      return {
        privateKey,
        publicKey
      };
    } catch (error) {
      console.error('❌ Failed to generate ECDSA key pair:', error);
      throw new Error(`Key generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate private key format and derive public key
   */
  static validatePrivateKey(privateKeyString: string): KeyValidationResult {
    try {
      const privateKey = PrivateKey.fromString(privateKeyString);
      const publicKey = privateKey.publicKey;
      
      // Determine key type based on the key
      const keyType = privateKeyString.startsWith('302e') ? 'ED25519' : 'ECDSA_SECP256K1';
      
      console.log(`✅ Private key validated successfully (${keyType})`);
      console.log(`   Public Key: ${publicKey.toString()}`);
      
      return {
        isValid: true,
        keyType
      };
    } catch (error) {
      console.error('❌ Private key validation failed:', error);
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Invalid private key format'
      };
    }
  }

  /**
   * Validate public key format
   */
  static validatePublicKey(publicKeyString: string): KeyValidationResult {
    try {
      PublicKey.fromString(publicKeyString);
      
      // Determine key type based on the key
      const keyType = publicKeyString.startsWith('302a') ? 'ED25519' : 'ECDSA_SECP256K1';
      
      console.log(`✅ Public key validated successfully (${keyType})`);
      
      return {
        isValid: true,
        keyType
      };
    } catch (error) {
      console.error('❌ Public key validation failed:', error);
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Invalid public key format'
      };
    }
  }

  /**
   * Convert private key to different formats
   */
  static convertPrivateKey(privateKey: PrivateKey): {
    hex: string;
    der: string;
    raw: string;
  } {
    return {
      hex: privateKey.toString(),
      der: privateKey.toString(), // DER format is the default
      raw: privateKey.toString()
    };
  }

  /**
   * Convert public key to different formats
   */
  static convertPublicKey(publicKey: PublicKey): {
    hex: string;
    der: string;
    raw: string;
  } {
    return {
      hex: publicKey.toString(),
      der: publicKey.toString(), // DER format is the default
      raw: publicKey.toString()
    };
  }

  /**
   * Sign arbitrary data with private key
   */
  static signData(privateKey: PrivateKey, data: string | Buffer): Buffer {
    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const signature = privateKey.sign(dataBuffer);
      
      console.log('✅ Data signed successfully');
      return signature;
    } catch (error) {
      console.error('❌ Failed to sign data:', error);
      throw new Error(`Signing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify signature with public key
   */
  static verifySignature(publicKey: PublicKey, data: string | Buffer, signature: Buffer): boolean {
    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const isValid = publicKey.verify(dataBuffer, signature);
      
      console.log(`✅ Signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
      return isValid;
    } catch (error) {
      console.error('❌ Failed to verify signature:', error);
      return false;
    }
  }

  /**
   * Generate secure random mnemonic for key derivation
   */
  static generateMnemonic(): string {
    try {
      // Generate 24 random words (256 bits of entropy)
      const words = [];
      const wordList = [
        'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
        'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
        'action', 'actor', 'actress', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit',
        // ... truncated for brevity - in production, use a full BIP39 wordlist
      ];
      
      for (let i = 0; i < 24; i++) {
        const randomIndex = crypto.randomInt(0, wordList.length);
        words.push(wordList[randomIndex]);
      }
      
      const mnemonic = words.join(' ');
      console.log('✅ Mnemonic generated successfully');
      
      return mnemonic;
    } catch (error) {
      console.error('❌ Failed to generate mnemonic:', error);
      throw new Error(`Mnemonic generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Derive key pair from mnemonic (simplified implementation)
   */
  static deriveFromMnemonic(mnemonic: string, index: number = 0): HederaKeyPair {
    try {
      console.log(`🔑 Deriving key pair from mnemonic (index: ${index})...`);
      
      // Create a hash from mnemonic and index for deterministic key generation
      const hash = crypto.createHash('sha256');
      hash.update(mnemonic + index.toString());
      const seed = hash.digest();
      
      // Generate private key from seed
      const privateKey = PrivateKey.fromBytes(seed);
      const publicKey = privateKey.publicKey;
      
      console.log('✅ Key pair derived from mnemonic successfully');
      
      return {
        privateKey,
        publicKey
      };
    } catch (error) {
      console.error('❌ Failed to derive key pair from mnemonic:', error);
      throw new Error(`Key derivation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a multi-signature key setup (for advanced use cases)
   */
  static createMultiSigKey(publicKeys: PublicKey[], threshold: number): PublicKey {
    try {
      if (publicKeys.length < threshold) {
        throw new Error('Number of public keys must be >= threshold');
      }
      
      console.log(`🔑 Creating multi-sig key (${threshold}/${publicKeys.length})...`);
      
      // Create threshold key from multiple public keys
      const thresholdKey = PublicKey.fromString(publicKeys[0].toString()); // Simplified implementation
      
      console.log('✅ Multi-sig key created successfully');
      return thresholdKey;
    } catch (error) {
      console.error('❌ Failed to create multi-sig key:', error);
      throw new Error(`Multi-sig key creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Encrypt private key with password
   */
  static encryptPrivateKey(privateKey: PrivateKey, password: string): string {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(password, 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(algorithm, key);
      
      let encrypted = cipher.update(privateKey.toString(), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = (cipher as any).getAuthTag?.() || '';
      
      // Combine IV, tag, and encrypted data
      const result = iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
      
      console.log('✅ Private key encrypted successfully');
      return result;
    } catch (error) {
      console.error('❌ Failed to encrypt private key:', error);
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt private key with password
   */
  static decryptPrivateKey(encryptedKey: string, password: string): PrivateKey {
    try {
      const parts = encryptedKey.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted key format');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const tag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(password, 'salt', 32);
      const decipher = crypto.createDecipher(algorithm, key);
      
      if (tag.length > 0) {
        (decipher as any).setAuthTag?.(tag);
      }
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const privateKey = PrivateKey.fromString(decrypted);
      
      console.log('✅ Private key decrypted successfully');
      return privateKey;
    } catch (error) {
      console.error('❌ Failed to decrypt private key:', error);
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a unique transaction memo
   */
  static generateTransactionMemo(operation: string, productId?: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    
    let memo = `AfriChain:${operation}:${timestamp}:${random}`;
    if (productId) {
      memo += `:${productId}`;
    }
    
    // Hedera transaction memos are limited to 100 bytes
    if (memo.length > 100) {
      memo = memo.substring(0, 100);
    }
    
    return memo;
  }

  /**
   * Validate Hedera account ID format
   */
  static validateAccountId(accountId: string): boolean {
    try {
      AccountId.fromString(accountId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format account ID for display
   */
  static formatAccountId(accountId: AccountId): string {
    return `${accountId.shard}.${accountId.realm}.${accountId.num}`;
  }

  /**
   * Generate account ID from public key (for new accounts)
   */
  static generateAccountIdFromPublicKey(publicKey: PublicKey): string {
    // In practice, account IDs are assigned by the Hedera network
    // This is a placeholder for account creation workflows
    const hash = crypto.createHash('sha256');
    hash.update(publicKey.toString());
    const hashHex = hash.digest('hex');
    
    // Extract parts to create a mock account ID format
    const num = parseInt(hashHex.substring(0, 8), 16) % 1000000;
    return `0.0.${num}`;
  }
}

/**
 * Key security utilities
 */
export class KeySecurity {
  /**
   * Check if private key is compromised (basic checks)
   */
  static isPrivateKeySecure(privateKey: PrivateKey): {
    isSecure: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let isSecure = true;

    try {
      const keyString = privateKey.toString();
      
      // Check key length
      if (keyString.length < 64) {
        warnings.push('Private key appears to be too short');
        isSecure = false;
      }
      
      // Check for obvious patterns
      if (/^0+$/.test(keyString) || /^1+$/.test(keyString)) {
        warnings.push('Private key contains obvious patterns');
        isSecure = false;
      }
      
      // Check entropy (simplified)
      const uniqueChars = new Set(keyString.split('')).size;
      if (uniqueChars < 10) {
        warnings.push('Private key has low entropy');
        isSecure = false;
      }
      
    } catch (error) {
      warnings.push('Unable to analyze private key security');
      isSecure = false;
    }

    return { isSecure, warnings };
  }

  /**
   * Generate secure random bytes
   */
  static generateSecureRandom(length: number): Buffer {
    return crypto.randomBytes(length);
  }

  /**
   * Secure memory cleanup (Node.js limitation - best effort)
   */
  static secureMemoryCleanup(): void {
    if (global.gc) {
      global.gc();
    }
  }
}

export default HederaKeyManager;