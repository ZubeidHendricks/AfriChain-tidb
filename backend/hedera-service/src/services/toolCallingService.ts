/**
 * Tool Calling Service - Manages specialized HCS and HTS agents
 * Provides direct blockchain operations without natural language processing
 */

import { HcsAgent, HcsOperation } from '../agents/HcsAgent';
import { HtsAgent, HtsOperation } from '../agents/HtsAgent';
import { publishToChannel } from '../config/redis';

interface ToolCallMessage {
  type: string;
  source: string;
  correlation_id?: string;
  payload: any;
  timestamp: string;
}

interface ToolCallResponse {
  type: string;
  source: string;
  correlation_id?: string;
  payload: any;
  timestamp: string;
}

export class ToolCallingService {
  private hcsAgent: HcsAgent | null = null;
  private htsAgent: HtsAgent | null = null;
  private isInitialized = false;

  constructor() {
    this.initializeAgents();
  }

  /**
   * Initialize specialized agents
   */
  private async initializeAgents(): Promise<void> {
    try {
      const accountId = process.env.HEDERA_ACCOUNT_ID || '0.0.123456';
      const privateKey = process.env.HEDERA_PRIVATE_KEY || 'dummy-key-for-development';
      const network = (process.env.HEDERA_NETWORK as 'testnet' | 'mainnet') || 'testnet';

      // Initialize HCS Agent
      this.hcsAgent = new HcsAgent(accountId, privateKey, network);
      await this.hcsAgent.initialize();

      // Initialize HTS Agent
      this.htsAgent = new HtsAgent(accountId, privateKey, network);
      await this.htsAgent.initialize();

      this.isInitialized = true;
      console.log('🔧 Tool Calling Service initialized with HCS and HTS agents');
    } catch (error) {
      console.error('❌ Failed to initialize Tool Calling Service:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Handle direct HCS tool calls
   */
  async handleHcsToolCall(message: ToolCallMessage): Promise<void> {
    if (!this.isInitialized || !this.hcsAgent) {
      await this.sendErrorResponse(message, 'HCS Agent not initialized');
      return;
    }

    try {
      const { operation, ...params } = message.payload;
      let result: HcsOperation;

      switch (operation) {
        case 'create_topic':
          result = await this.hcsAgent.createTopic(params.memo, params.adminKey);
          break;

        case 'submit_message':
          result = await this.hcsAgent.submitMessage(params.topicId, params.message);
          break;

        case 'natural_language':
          result = await this.hcsAgent.executeOperation(params.request);
          break;

        default:
          await this.sendErrorResponse(message, `Unknown HCS operation: ${operation}`);
          return;
      }

      await this.sendResponse(message, 'hcs_tool_call_response', {
        operation,
        success: result.success,
        message: result.message,
        transactionId: result.transactionId,
        topicId: result.topicId,
        sequenceNumber: result.sequenceNumber,
        consensusTimestamp: result.consensusTimestamp,
        details: result.details,
      });

    } catch (error) {
      console.error('Error handling HCS tool call:', error);
      await this.sendErrorResponse(message, `HCS tool call failed: ${error.message}`);
    }
  }

  /**
   * Handle direct HTS tool calls
   */
  async handleHtsToolCall(message: ToolCallMessage): Promise<void> {
    if (!this.isInitialized || !this.htsAgent) {
      await this.sendErrorResponse(message, 'HTS Agent not initialized');
      return;
    }

    try {
      const { operation, ...params } = message.payload;
      let result: HtsOperation;

      switch (operation) {
        case 'create_fungible_token':
          result = await this.htsAgent.createFungibleToken(
            params.name,
            params.symbol,
            params.decimals,
            params.initialSupply
          );
          break;

        case 'create_nft_collection':
          result = await this.htsAgent.createNftCollection(params.name, params.symbol);
          break;

        case 'mint_nft':
          result = await this.htsAgent.mintNft(params.tokenId, params.metadata);
          break;

        case 'transfer_token':
          result = await this.htsAgent.transferToken(
            params.tokenId,
            params.toAccountId,
            params.amount
          );
          break;

        case 'natural_language':
          result = await this.htsAgent.executeOperation(params.request);
          break;

        default:
          await this.sendErrorResponse(message, `Unknown HTS operation: ${operation}`);
          return;
      }

      await this.sendResponse(message, 'hts_tool_call_response', {
        operation,
        success: result.success,
        message: result.message,
        transactionId: result.transactionId,
        tokenId: result.tokenId,
        serialNumber: result.serialNumber,
        amount: result.amount,
        balance: result.balance,
        details: result.details,
      });

    } catch (error) {
      console.error('Error handling HTS tool call:', error);
      await this.sendErrorResponse(message, `HTS tool call failed: ${error.message}`);
    }
  }

  /**
   * Handle hybrid operations (combining HCS and HTS)
   */
  async handleHybridOperation(message: ToolCallMessage): Promise<void> {
    if (!this.isInitialized || !this.hcsAgent || !this.htsAgent) {
      await this.sendErrorResponse(message, 'Hybrid agents not initialized');
      return;
    }

    try {
      const { operation, ...params } = message.payload;
      let results: Array<HcsOperation | HtsOperation> = [];

      switch (operation) {
        case 'create_authenticity_certificate':
          // 1. Create NFT for product certificate
          const nftResult = await this.htsAgent.createNftCollection(
            params.productName + ' Certificate',
            params.symbol || 'CERT'
          );

          // 2. Log the certificate creation to HCS
          const hcsResult = await this.hcsAgent.submitMessage(
            params.auditTopicId,
            JSON.stringify({
              action: 'certificate_created',
              tokenId: nftResult.tokenId,
              productName: params.productName,
              timestamp: new Date().toISOString(),
            })
          );

          results = [nftResult, hcsResult];
          break;

        case 'verify_product_authenticity':
          // 1. Mint authenticity NFT
          const mintResult = await this.htsAgent.mintNft(params.tokenId, {
            productId: params.productId,
            verified: true,
            verificationDate: new Date().toISOString(),
            verifier: params.verifierAccount,
          });

          // 2. Log verification to consensus
          const logResult = await this.hcsAgent.submitMessage(
            params.auditTopicId,
            JSON.stringify({
              action: 'product_verified',
              productId: params.productId,
              tokenId: params.tokenId,
              serialNumber: mintResult.serialNumber,
              verifier: params.verifierAccount,
              timestamp: new Date().toISOString(),
            })
          );

          results = [mintResult, logResult];
          break;

        default:
          await this.sendErrorResponse(message, `Unknown hybrid operation: ${operation}`);
          return;
      }

      await this.sendResponse(message, 'hybrid_operation_response', {
        operation,
        success: results.every(r => r.success),
        message: `Hybrid operation completed: ${operation}`,
        results: results,
        details: {
          hcsResult: results.find(r => 'topicId' in r),
          htsResult: results.find(r => 'tokenId' in r),
        },
      });

    } catch (error) {
      console.error('Error handling hybrid operation:', error);
      await this.sendErrorResponse(message, `Hybrid operation failed: ${error.message}`);
    }
  }

  /**
   * Get tool capabilities and status
   */
  async handleToolStatus(message: ToolCallMessage): Promise<void> {
    const status = {
      initialized: this.isInitialized,
      hcsAgent: {
        ready: this.hcsAgent?.getStatus().ready || false,
        tools: this.hcsAgent?.getAvailableTools() || [],
        status: this.hcsAgent?.getStatus(),
      },
      htsAgent: {
        ready: this.htsAgent?.getStatus().ready || false,
        tools: this.htsAgent?.getAvailableTools() || [],
        status: this.htsAgent?.getStatus(),
      },
      hybridOperations: [
        'create_authenticity_certificate',
        'verify_product_authenticity',
      ],
    };

    await this.sendResponse(message, 'tool_status_response', status);
  }

  /**
   * Send successful response
   */
  private async sendResponse(
    originalMessage: ToolCallMessage,
    responseType: string,
    payload: any
  ): Promise<void> {
    const response: ToolCallResponse = {
      type: responseType,
      source: 'hedera-tool-calling-service',
      correlation_id: originalMessage.correlation_id,
      payload,
      timestamp: new Date().toISOString(),
    };

    await publishToChannel('hedera.tool.responses', response);
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(
    originalMessage: ToolCallMessage,
    error: string
  ): Promise<void> {
    const response: ToolCallResponse = {
      type: 'tool_call_error_response',
      source: 'hedera-tool-calling-service',
      correlation_id: originalMessage.correlation_id,
      payload: {
        success: false,
        error,
        originalMessage: originalMessage.type,
      },
      timestamp: new Date().toISOString(),
    };

    await publishToChannel('hedera.tool.responses', response);
  }

  /**
   * Get current status
   */
  getStatus(): { initialized: boolean; hcsReady: boolean; htsReady: boolean } {
    return {
      initialized: this.isInitialized,
      hcsReady: this.hcsAgent?.getStatus().ready || false,
      htsReady: this.htsAgent?.getStatus().ready || false,
    };
  }
}

export default ToolCallingService;