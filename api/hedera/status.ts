/**
 * VeriChainX Hedera Agent Status Endpoint
 * Check agent health, account balance, and system status
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Client, PrivateKey, AccountBalanceQuery, AccountInfoQuery } from '@hashgraph/sdk';

interface AgentStatus {
  agent: string;
  status: 'online' | 'offline' | 'error';
  account_id: string;
  network: string;
  balance?: string;
  account_info?: any;
  features: string[];
  endpoints: string[];
  last_updated: number;
  error?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Hedera client
    const client = Client.forTestnet();
    const accountId = process.env.HEDERA_ACCOUNT_ID || '0.0.6503585';
    const privateKey = process.env.HEDERA_PRIVATE_KEY;

    if (!privateKey) {
      throw new Error('HEDERA_PRIVATE_KEY not configured');
    }

    client.setOperator(
      accountId,
      PrivateKey.fromString(privateKey)
    );

    // Test connection with balance query
    const balance = await new AccountBalanceQuery()
      .setAccountId(accountId)
      .execute(client);

    // Get account info
    const accountInfo = await new AccountInfoQuery()
      .setAccountId(accountId)
      .execute(client);

    const status: AgentStatus = {
      agent: 'VeriChainX Hedera AI Studio Agent',
      status: 'online',
      account_id: accountId,
      network: 'testnet',
      balance: balance.hbars.toString(),
      account_info: {
        key: accountInfo.key?.toString().substring(0, 20) + '...',
        memo: accountInfo.accountMemo,
        auto_renew_period: accountInfo.autoRenewPeriod?.seconds.toString(),
        expiration_time: accountInfo.expirationTime?.toDate().toISOString()
      },
      features: [
        'Verifiable AI Decisions',
        'HCS Audit Trails', 
        'NFT Certificate Minting',
        'Natural Language Interface',
        'Product Authenticity Analysis',
        'Multi-Agent Coordination',
        'Transparent Blockchain Integration'
      ],
      endpoints: [
        '/api/hedera/ai-studio-agent',
        '/api/hedera/natural-language',
        '/api/hedera/status',
        '/api/hedera/test-connection'
      ],
      last_updated: Date.now()
    };

    res.status(200).json(status);

  } catch (error) {
    console.error('Hedera agent status error:', error);
    
    const errorStatus: AgentStatus = {
      agent: 'VeriChainX Hedera AI Studio Agent',
      status: 'error',
      account_id: process.env.HEDERA_ACCOUNT_ID || '0.0.6503585',
      network: 'testnet',
      features: [],
      endpoints: [],
      last_updated: Date.now(),
      error: error.message
    };

    res.status(500).json(errorStatus);
  }
}