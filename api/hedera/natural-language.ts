/**
 * VeriChainX Natural Language Blockchain Interface
 * Inspired by Hedera AI Studio's ElizaOS Plugin for natural language blockchain interaction
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Client, PrivateKey, AccountBalanceQuery, TopicMessageSubmitTransaction } from '@hashgraph/sdk';

interface NaturalLanguageRequest {
  command: string;
  context?: any;
}

interface CommandResult {
  success: boolean;
  action: string;
  result: any;
  explanation: string;
  blockchain_transaction?: string;
  verification_url?: string;
}

class NaturalLanguageBlockchainInterface {
  private client: Client;

  constructor() {
    this.client = Client.forTestnet();
    this.client.setOperator(
      process.env.HEDERA_ACCOUNT_ID || '0.0.6503585',
      PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY || '')
    );
  }

  /**
   * Parse natural language commands and convert to blockchain actions
   */
  async processCommand(command: string, context?: any): Promise<CommandResult> {
    const normalizedCommand = command.toLowerCase().trim();

    try {
      // Check balance commands
      if (this.isBalanceQuery(normalizedCommand)) {
        return await this.handleBalanceQuery();
      }

      // NFT minting commands
      if (this.isNFTMintCommand(normalizedCommand)) {
        return await this.handleNFTMinting(command, context);
      }

      // Audit/logging commands
      if (this.isAuditCommand(normalizedCommand)) {
        return await this.handleAuditLogging(command, context);
      }

      // Product analysis commands
      if (this.isAnalysisCommand(normalizedCommand)) {
        return await this.handleProductAnalysis(command, context);
      }

      // Status check commands
      if (this.isStatusCommand(normalizedCommand)) {
        return await this.handleStatusCheck();
      }

      // Default response for unrecognized commands
      return {
        success: false,
        action: 'unknown_command',
        result: null,
        explanation: `I don't understand the command: "${command}". Try commands like:
        - "Check my account balance"
        - "Mint an authenticity NFT for product 12345"
        - "Submit audit message about counterfeit detection"
        - "Analyze this product for authenticity"
        - "What's my agent status?"`
      };

    } catch (error) {
      return {
        success: false,
        action: 'error',
        result: null,
        explanation: `Error processing command: ${error.message}`
      };
    }
  }

  private isBalanceQuery(command: string): boolean {
    return command.includes('balance') || 
           command.includes('how much') ||
           command.includes('account status') ||
           command.includes('my hbar');
  }

  private async handleBalanceQuery(): Promise<CommandResult> {
    const balance = await new AccountBalanceQuery()
      .setAccountId(process.env.HEDERA_ACCOUNT_ID!)
      .execute(this.client);

    return {
      success: true,
      action: 'balance_query',
      result: {
        account_id: process.env.HEDERA_ACCOUNT_ID,
        balance: balance.hbars.toString(),
        network: 'testnet'
      },
      explanation: `Your Hedera testnet account (${process.env.HEDERA_ACCOUNT_ID}) has a balance of ${balance.hbars.toString()}.`
    };
  }

  private isNFTMintCommand(command: string): boolean {
    return (command.includes('mint') || command.includes('create')) && 
           (command.includes('nft') || command.includes('certificate') || command.includes('token'));
  }

  private async handleNFTMinting(command: string, context?: any): Promise<CommandResult> {
    // Extract product ID from command
    const productIdMatch = command.match(/product\s+(\d+)/i) || command.match(/#(\d+)/);
    const productId = productIdMatch ? productIdMatch[1] : (context?.product_id || '12345');

    // Extract score if mentioned
    const scoreMatch = command.match(/(\d+(?:\.\d+)?)\s*%/) || command.match(/score\s+(\d+(?:\.\d+)?)/i);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) / 100 : (context?.score || 0.95);

    try {
      // Call the main AI Studio agent for NFT minting
      const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/hedera/ai-studio-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mint_nft',
          data: {
            product_id: productId,
            authenticity_score: score,
            metadata: {
              created_via: 'natural_language_interface',
              command: command,
              timestamp: Date.now()
            }
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        return {
          success: true,
          action: 'nft_minted',
          result: result.result,
          explanation: `Successfully minted an authenticity NFT certificate for product ${productId} with ${(score * 100).toFixed(1)}% authenticity score.`,
          blockchain_transaction: result.result?.transactionId,
          verification_url: `https://hashscan.io/testnet/transaction/${result.result?.transactionId}`
        };
      } else {
        throw new Error(result.error || 'Failed to mint NFT');
      }
    } catch (error) {
      return {
        success: false,
        action: 'nft_mint_failed',
        result: null,
        explanation: `Failed to mint NFT certificate: ${error.message}`
      };
    }
  }

  private isAuditCommand(command: string): boolean {
    return command.includes('audit') || 
           command.includes('log') ||
           command.includes('record') ||
           command.includes('submit message');
  }

  private async handleAuditLogging(command: string, context?: any): Promise<CommandResult> {
    // Extract message from command
    const messageMatch = command.match(/(?:about|message)\s+"([^"]+)"/i) || 
                        command.match(/(?:about|message)\s+(.+)$/i);
    const message = messageMatch ? messageMatch[1] : context?.message || 'Audit log entry via natural language';

    try {
      const auditRecord = {
        type: 'natural_language_audit',
        message: message,
        command: command,
        timestamp: Date.now(),
        account: process.env.HEDERA_ACCOUNT_ID
      };

      // Submit to HCS (using a default topic for now)
      const topicId = process.env.HCS_AUDIT_TOPIC_ID || '0.0.1234567'; // Default topic
      
      const messageTx = new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(auditRecord));

      const response = await messageTx.execute(this.client);
      const transactionId = response.transactionId.toString();

      return {
        success: true,
        action: 'audit_logged',
        result: {
          message: message,
          topic_id: topicId,
          transaction_id: transactionId
        },
        explanation: `Successfully submitted audit message "${message}" to HCS topic ${topicId}.`,
        blockchain_transaction: transactionId,
        verification_url: `https://hashscan.io/testnet/transaction/${transactionId}`
      };
    } catch (error) {
      return {
        success: false,
        action: 'audit_failed',
        result: null,
        explanation: `Failed to submit audit message: ${error.message}`
      };
    }
  }

  private isAnalysisCommand(command: string): boolean {
    return command.includes('analyze') || 
           command.includes('check') ||
           command.includes('verify') ||
           command.includes('authentic');
  }

  private async handleProductAnalysis(command: string, context?: any): Promise<CommandResult> {
    // Extract product information from command or context
    const productData = context?.product || {
      product_name: this.extractProductName(command) || 'Unknown Product',
      price: this.extractPrice(command) || 999.99,
      seller_info: { name: 'Unknown Seller', verified: false }
    };

    try {
      // Call the main AI Studio agent for analysis
      const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/hedera/ai-studio-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze_product',
          data: productData
        })
      });

      const result = await response.json();

      if (result.success) {
        const analysis = result.result;
        const verdict = analysis.is_counterfeit ? 'potentially counterfeit' : 'appears authentic';
        const confidence = (analysis.authenticity_score * 100).toFixed(1);

        return {
          success: true,
          action: 'product_analyzed',
          result: analysis,
          explanation: `Analysis complete: ${productData.product_name} ${verdict} with ${confidence}% confidence. ${analysis.nft_certificate ? 'NFT certificate minted.' : ''}`,
          blockchain_transaction: result.hcs_transaction_id,
          verification_url: result.verification_url
        };
      } else {
        throw new Error('Analysis failed');
      }
    } catch (error) {
      return {
        success: false,
        action: 'analysis_failed',
        result: null,
        explanation: `Failed to analyze product: ${error.message}`
      };
    }
  }

  private isStatusCommand(command: string): boolean {
    return command.includes('status') || 
           command.includes('health') ||
           command.includes('info') ||
           command.includes('what') && command.includes('doing');
  }

  private async handleStatusCheck(): Promise<CommandResult> {
    try {
      // Call the main AI Studio agent for status
      const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/hedera/ai-studio-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get_status'
        })
      });

      const status = await response.json();

      return {
        success: true,
        action: 'status_check',
        result: status,
        explanation: `VeriChainX AI Studio Agent is ${status.status}. Account ${status.account_id} on ${status.network} with balance ${status.balance}.`
      };
    } catch (error) {
      return {
        success: false,
        action: 'status_failed',
        result: null,
        explanation: `Failed to get agent status: ${error.message}`
      };
    }
  }

  private extractProductName(command: string): string | null {
    const patterns = [
      /(?:analyze|check|verify)\s+(?:this\s+)?(.+?)(?:\s+for|\s+at|\s+priced|$)/i,
      /"([^"]+)"/,
      /product\s+(.+?)(?:\s|$)/i
    ];

    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  private extractPrice(command: string): number | null {
    const priceMatch = command.match(/\$(\d+(?:\.\d{2})?)/);
    return priceMatch ? parseFloat(priceMatch[1]) : null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { command, context } = req.body as NaturalLanguageRequest;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    const nlInterface = new NaturalLanguageBlockchainInterface();
    const result = await nlInterface.processCommand(command, context);

    res.status(200).json({
      ...result,
      interface: 'VeriChainX Natural Language Blockchain Interface',
      powered_by: 'Hedera AI Studio',
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Natural language interface error:', error);
    res.status(500).json({
      error: error.message,
      interface: 'VeriChainX Natural Language Blockchain Interface',
      timestamp: Date.now()
    });
  }
}