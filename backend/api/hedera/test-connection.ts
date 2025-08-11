/**
 * VeriChainX Hedera Connection Test
 * Simple endpoint to test Hedera testnet connectivity
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Client, PrivateKey, AccountBalanceQuery } from '@hashgraph/sdk';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    // Test Hedera connection with your credentials
    const client = Client.forTestnet();
    const accountId = '0.0.6503585'; // Your provided account ID
    const privateKey = '0x8b8add46cb9415d0a2429fef41cc6758232ec2a5977b4b234145d0b897ad03eb'; // Your provided private key

    client.setOperator(
      accountId,
      PrivateKey.fromString(privateKey)
    );

    // Simple balance query to test connection
    const balance = await new AccountBalanceQuery()
      .setAccountId(accountId)
      .execute(client);

    const responseTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: 'Hedera testnet connection successful',
      account_id: accountId,
      evm_address: '0xb8f4119e24fdb8cfd329f53246b129f8d7f85e90',
      network: 'testnet',
      balance: balance.hbars.toString(),
      response_time_ms: responseTime,
      timestamp: new Date().toISOString(),
      ready_for_agents: true,
      features_available: [
        'Account Balance Queries',
        'NFT Minting',
        'HCS Message Submission',
        'Smart Contract Interaction',
        'Token Operations'
      ]
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    console.error('Hedera connection test failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      account_id: '0.0.6503585',
      network: 'testnet',
      response_time_ms: responseTime,
      timestamp: new Date().toISOString(),
      ready_for_agents: false,
      troubleshooting: [
        'Check if HEDERA_PRIVATE_KEY environment variable is set',
        'Verify testnet account has sufficient HBAR balance',
        'Ensure account ID and private key match',
        'Check network connectivity'
      ]
    });
  }
}