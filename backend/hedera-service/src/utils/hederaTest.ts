import { AccountBalanceQuery, AccountId } from '@hashgraph/sdk';
import { getHederaClient } from '../config/hedera';

export async function testHederaConnection(): Promise<{
  success: boolean;
  account_id?: string;
  balance?: string;
  network?: string;
  error?: string;
}> {
  try {
    const client = getHederaClient();
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    
    if (!accountId) {
      throw new Error('HEDERA_ACCOUNT_ID not configured');
    }

    // Query account balance to test connection
    const accountBalance = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);

    return {
      success: true,
      account_id: accountId,
      balance: accountBalance.hbars.toString(),
      network: process.env.HEDERA_NETWORK || 'testnet',
    };
  } catch (error) {
    console.error('Hedera connection test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function createTestTransaction(): Promise<{
  success: boolean;
  transaction_id?: string;
  error?: string;
}> {
  try {
    // For now, just return a mock successful response
    // Real transaction implementation will be added in later stories
    return {
      success: true,
      transaction_id: 'mock-transaction-id-for-testing',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}