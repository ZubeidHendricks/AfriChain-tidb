/**
 * VeriChainX AI Studio Enhanced Agent
 * Integrates Hedera AI Studio SDK with VeriChainX for transparent, verifiable AI decisions
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { HederaAgentKit } from 'hedera-agent-kit';
import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hashgraph/sdk';

interface AgentRequest {
  action: string;
  data: any;
  requiresVerification?: boolean;
}

interface VerifiableResult {
  success: boolean;
  result: any;
  hcs_transaction_id?: string;
  verification_url?: string;
  agent_used: string;
  timestamp: number;
  account_id: string;
}

class VeriChainXAIStudioAgent {
  private client: Client;
  private agentKit: HederaAgentKit;
  private auditTopicId: string;

  constructor() {
    // Initialize Hedera client with provided credentials
    this.client = Client.forTestnet();
    this.client.setOperator(
      process.env.HEDERA_ACCOUNT_ID || '0.0.6503585',
      PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY || '')
    );

    // Initialize Hedera Agent Kit
    this.agentKit = new HederaAgentKit({
      accountId: process.env.HEDERA_ACCOUNT_ID || '0.0.6503585',
      privateKey: process.env.HEDERA_PRIVATE_KEY || '',
      network: 'testnet',
    });

    // Default audit topic ID (will be created if not exists)
    this.auditTopicId = process.env.HCS_AUDIT_TOPIC_ID || '';
  }

  /**
   * Create audit trail topic for transparent AI decisions
   */
  async createAuditTopic(): Promise<string> {
    try {
      const topicTx = new TopicCreateTransaction()
        .setTopicMemo('VeriChainX AI Studio Audit Trail')
        .setAdminKey(this.client.operatorPublicKey!)
        .setSubmitKey(this.client.operatorPublicKey!);

      const response = await topicTx.execute(this.client);
      const receipt = await response.getReceipt(this.client);
      
      if (receipt.topicId) {
        this.auditTopicId = receipt.topicId.toString();
        return this.auditTopicId;
      }
      throw new Error('Failed to create audit topic');
    } catch (error) {
      console.error('Error creating audit topic:', error);
      throw error;
    }
  }

  /**
   * Log AI decision to HCS for verifiable audit trail
   */
  async logToHCS(decision: any): Promise<string> {
    try {
      if (!this.auditTopicId) {
        await this.createAuditTopic();
      }

      const auditRecord = {
        timestamp: Date.now(),
        agent: 'verichain-x-ai-studio',
        account: process.env.HEDERA_ACCOUNT_ID,
        action: decision.action,
        input_hash: this.hashData(decision.input),
        result_hash: this.hashData(decision.result),
        confidence: decision.confidence || 1.0,
        reasoning: decision.reasoning,
        network: 'testnet'
      };

      const messageTx = new TopicMessageSubmitTransaction()
        .setTopicId(this.auditTopicId)
        .setMessage(JSON.stringify(auditRecord));

      const response = await messageTx.execute(this.client);
      const receipt = await response.getReceipt(this.client);

      return response.transactionId.toString();
    } catch (error) {
      console.error('Error logging to HCS:', error);
      throw error;
    }
  }

  /**
   * Mint authenticity NFT using AI Studio enhanced process
   */
  async mintAuthenticityNFT(productData: any): Promise<any> {
    try {
      const nftData = {
        name: `VeriChainX Authenticity Certificate #${productData.product_id}`,
        symbol: 'VCXAUTH',
        metadata: {
          product_id: productData.product_id,
          authenticity_score: productData.authenticity_score,
          analysis_timestamp: Date.now(),
          verified_by: 'VeriChainX AI Studio Agent',
          evidence: productData.evidence || [],
          account: process.env.HEDERA_ACCOUNT_ID
        }
      };

      // Use Hedera Agent Kit for NFT creation
      const nftResult = await this.agentKit.createNFT(nftData);

      // Log NFT minting decision to HCS
      await this.logToHCS({
        action: 'nft_minted',
        input: productData,
        result: nftResult,
        reasoning: `Product ${productData.product_id} verified with score ${productData.authenticity_score}`
      });

      return nftResult;
    } catch (error) {
      console.error('Error minting NFT:', error);
      throw error;
    }
  }

  /**
   * Submit product analysis with verifiable AI decisions
   */
  async analyzeProduct(productData: any): Promise<VerifiableResult> {
    try {
      // Simulate AI analysis (in production, this would call actual AI)
      const analysis = {
        authenticity_score: this.calculateScore(productData),
        is_counterfeit: false,
        confidence: 0.95,
        reasoning: `Analysis of ${productData.product_name} at price $${productData.price}`,
        evidence: [
          'Price analysis completed',
          'Seller verification checked',
          'Product category assessed'
        ]
      };

      analysis.is_counterfeit = analysis.authenticity_score < 0.5;

      // Log AI decision to HCS for transparency
      const hcsTransactionId = await this.logToHCS({
        action: 'product_analysis',
        input: productData,
        result: analysis,
        reasoning: analysis.reasoning
      });

      // If authentic, mint NFT certificate
      let nftResult = null;
      if (analysis.authenticity_score > 0.7) {
        nftResult = await this.mintAuthenticityNFT({
          ...productData,
          authenticity_score: analysis.authenticity_score,
          evidence: analysis.evidence
        });
      }

      return {
        success: true,
        result: {
          ...analysis,
          nft_certificate: nftResult
        },
        hcs_transaction_id: hcsTransactionId,
        verification_url: `https://hashscan.io/testnet/transaction/${hcsTransactionId}`,
        agent_used: 'verichain-x-ai-studio',
        timestamp: Date.now(),
        account_id: process.env.HEDERA_ACCOUNT_ID || '0.0.6503585'
      };
    } catch (error) {
      console.error('Error in product analysis:', error);
      throw error;
    }
  }

  /**
   * Get agent status and Hedera account information
   */
  async getAgentStatus(): Promise<any> {
    try {
      const balance = await this.client.getAccountBalance(process.env.HEDERA_ACCOUNT_ID!);
      
      return {
        agent: 'VeriChainX AI Studio Agent',
        status: 'online',
        account_id: process.env.HEDERA_ACCOUNT_ID,
        network: 'testnet',
        balance: balance.hbars.toString(),
        audit_topic_id: this.auditTopicId,
        features: [
          'Verifiable AI Decisions',
          'HCS Audit Trails',
          'NFT Certificate Minting',
          'Natural Language Interface',
          'Transparent Analysis'
        ],
        last_updated: Date.now()
      };
    } catch (error) {
      console.error('Error getting agent status:', error);
      return {
        agent: 'VeriChainX AI Studio Agent',
        status: 'error',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  private calculateScore(productData: any): number {
    // Simple scoring algorithm (in production, this would be more sophisticated)
    let score = 0.5;

    if (productData.price > 1000) score += 0.2;
    if (productData.seller_info?.verified) score += 0.2;
    if (productData.product_name.toLowerCase().includes('iphone') && productData.price < 300) {
      score -= 0.4; // Suspicious pricing
    }

    return Math.max(0.0, Math.min(1.0, score));
  }

  private hashData(data: any): string {
    // Simple hash for demo (in production, use proper cryptographic hash)
    return Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 16);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const agent = new VeriChainXAIStudioAgent();
    const { action, data } = req.body as AgentRequest;

    switch (action) {
      case 'analyze_product':
        const analysisResult = await agent.analyzeProduct(data);
        res.status(200).json(analysisResult);
        break;

      case 'mint_nft':
        const nftResult = await agent.mintAuthenticityNFT(data);
        res.status(200).json({
          success: true,
          result: nftResult,
          agent_used: 'verichain-x-ai-studio',
          timestamp: Date.now()
        });
        break;

      case 'get_status':
        const status = await agent.getAgentStatus();
        res.status(200).json(status);
        break;

      case 'create_audit_topic':
        const topicId = await agent.createAuditTopic();
        res.status(200).json({
          success: true,
          topic_id: topicId,
          message: 'Audit topic created successfully'
        });
        break;

      default:
        res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('AI Studio Agent error:', error);
    res.status(500).json({
      error: error.message,
      agent: 'verichain-x-ai-studio',
      timestamp: Date.now()
    });
  }
}