/**
 * Agent Service - Integrates Hedera Agent Kit with message handling
 */

import { HederaLangChainAgent, createHederaAgent, HederaAgentConfig, TransactionResult } from '../agents/HederaAgentKit';
import { publishToChannel } from '../config/redis';
import { z } from 'zod';

interface AgentMessage {
  type: string;
  source: string;
  correlation_id?: string;
  payload: any;
  timestamp: string;
}

interface AgentResponse {
  type: string;
  source: string;
  correlation_id?: string;
  payload: any;
  timestamp: string;
}

export class HederaAgentService {
  private agent: HederaLangChainAgent | null = null;
  private isInitialized = false;

  constructor() {
    this.initializeAgent();
  }

  /**
   * Initialize the Hedera LangChain Agent
   */
  private async initializeAgent(): Promise<void> {
    try {
      // Get configuration from environment
      const config: HederaAgentConfig = {
        accountId: process.env.HEDERA_ACCOUNT_ID || '0.0.123456',
        privateKey: process.env.HEDERA_PRIVATE_KEY || 'dummy-key-for-development',
        network: (process.env.HEDERA_NETWORK as 'testnet' | 'mainnet') || 'testnet',
        openaiApiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      };

      this.agent = createHederaAgent(config);
      await this.agent.initializeAgent();
      this.isInitialized = true;

      console.log('🤖 Hedera Agent Kit initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Hedera Agent Kit:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Handle natural language blockchain requests
   */
  async handleNaturalLanguageRequest(message: AgentMessage): Promise<void> {
    if (!this.isInitialized || !this.agent) {
      await this.sendErrorResponse(message, 'Agent not initialized');
      return;
    }

    try {
      const { request } = message.payload;
      
      if (!request || typeof request !== 'string') {
        await this.sendErrorResponse(message, 'Invalid request format. Expected string request.');
        return;
      }

      console.log(`🧠 Processing natural language request: "${request}"`);
      
      const result: TransactionResult = await this.agent.processRequest(request);
      
      await this.sendResponse(message, 'natural_language_response', {
        success: result.success,
        message: result.message,
        transactionId: result.transactionId,
        details: result.details,
        originalRequest: request,
      });

    } catch (error) {
      console.error('Error processing natural language request:', error);
      await this.sendErrorResponse(message, `Processing failed: ${error.message}`);
    }
  }

  /**
   * Handle direct tool calls (HCS operations)
   */
  async handleHcsOperation(message: AgentMessage): Promise<void> {
    if (!this.isInitialized || !this.agent) {
      await this.sendErrorResponse(message, 'Agent not initialized');
      return;
    }

    try {
      const { operation, ...params } = message.payload;

      let result: TransactionResult;

      switch (operation) {
        case 'create_topic':
          result = await this.agent.processRequest(`Create a new HCS topic with memo: ${params.memo}`);
          break;
        
        case 'submit_message':
          result = await this.agent.processRequest(
            `Submit message "${params.message}" to topic ${params.topicId}`
          );
          break;
        
        default:
          await this.sendErrorResponse(message, `Unknown HCS operation: ${operation}`);
          return;
      }

      await this.sendResponse(message, 'hcs_operation_response', {
        operation,
        success: result.success,
        message: result.message,
        transactionId: result.transactionId,
        details: result.details,
      });

    } catch (error) {
      console.error('Error handling HCS operation:', error);
      await this.sendErrorResponse(message, `HCS operation failed: ${error.message}`);
    }
  }

  /**
   * Handle direct tool calls (HTS operations)
   */
  async handleHtsOperation(message: AgentMessage): Promise<void> {
    if (!this.isInitialized || !this.agent) {
      await this.sendErrorResponse(message, 'Agent not initialized');
      return;
    }

    try {
      const { operation, ...params } = message.payload;

      let result: TransactionResult;

      switch (operation) {
        case 'create_token':
          result = await this.agent.processRequest(
            `Create a new token named "${params.name}" with symbol "${params.symbol}", ${params.decimals} decimals, and initial supply of ${params.initialSupply}`
          );
          break;
        
        case 'mint_token':
          result = await this.agent.processRequest(
            `Mint ${params.amount} tokens for token ${params.tokenId}`
          );
          break;
        
        case 'transfer_token':
          result = await this.agent.processRequest(
            `Transfer ${params.amount} of token ${params.tokenId} to account ${params.toAccountId}`
          );
          break;
        
        case 'transfer_hbar':
          result = await this.agent.processRequest(
            `Transfer ${params.amount} HBAR to account ${params.toAccountId}`
          );
          break;
        
        case 'get_balance':
          result = await this.agent.processRequest(
            `Get account balance for ${params.accountId}`
          );
          break;
        
        default:
          await this.sendErrorResponse(message, `Unknown HTS operation: ${operation}`);
          return;
      }

      await this.sendResponse(message, 'hts_operation_response', {
        operation,
        success: result.success,
        message: result.message,
        transactionId: result.transactionId,
        details: result.details,
      });

    } catch (error) {
      console.error('Error handling HTS operation:', error);
      await this.sendErrorResponse(message, `HTS operation failed: ${error.message}`);
    }
  }

  /**
   * Get agent status and capabilities
   */
  async handleAgentStatus(message: AgentMessage): Promise<void> {
    const status = {
      initialized: this.isInitialized,
      ready: this.agent?.isReady() || false,
      config: this.agent?.getConfig() || null,
      availableTools: this.agent?.getAvailableTools() || [],
    };

    await this.sendResponse(message, 'agent_status_response', status);
  }

  /**
   * Send successful response
   */
  private async sendResponse(
    originalMessage: AgentMessage,
    responseType: string,
    payload: any
  ): Promise<void> {
    const response: AgentResponse = {
      type: responseType,
      source: 'hedera-agent-service',
      correlation_id: originalMessage.correlation_id,
      payload,
      timestamp: new Date().toISOString(),
    };

    await publishToChannel('hedera.agent.responses', response);
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(originalMessage: AgentMessage, error: string): Promise<void> {
    const response: AgentResponse = {
      type: 'error_response',
      source: 'hedera-agent-service',
      correlation_id: originalMessage.correlation_id,
      payload: {
        success: false,
        error,
        originalMessage: originalMessage.type,
      },
      timestamp: new Date().toISOString(),
    };

    await publishToChannel('hedera.agent.responses', response);
  }

  /**
   * Get current status
   */
  getStatus(): { initialized: boolean; ready: boolean } {
    return {
      initialized: this.isInitialized,
      ready: this.agent?.isReady() || false,
    };
  }
}

// Validation schemas for different operations
export const operationSchemas = {
  naturalLanguage: z.object({
    request: z.string().min(1).max(1000),
  }),

  hcsCreateTopic: z.object({
    operation: z.literal('create_topic'),
    memo: z.string().min(1).max(100),
  }),

  hcsSubmitMessage: z.object({
    operation: z.literal('submit_message'),
    topicId: z.string(),
    message: z.string().max(1024),
  }),

  htsCreateToken: z.object({
    operation: z.literal('create_token'),
    name: z.string().min(1).max(100),
    symbol: z.string().min(1).max(10),
    decimals: z.number().min(0).max(18),
    initialSupply: z.number().min(0),
  }),

  htsTransferToken: z.object({
    operation: z.literal('transfer_token'),
    tokenId: z.string(),
    toAccountId: z.string(),
    amount: z.number().positive(),
  }),

  htsTransferHbar: z.object({
    operation: z.literal('transfer_hbar'),
    toAccountId: z.string(),
    amount: z.number().positive(),
  }),

  getBalance: z.object({
    operation: z.literal('get_balance'),
    accountId: z.string(),
  }),
};

export default HederaAgentService;