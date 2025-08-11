import { getRedisClient, publishToChannel } from '../config/redis';
import HederaAgentService from './agentService';
import ToolCallingService from './toolCallingService';
import HitlService from './hitlService';

export interface HederaAgentMessage {
  type: string;
  payload: Record<string, any>;
  source: string;
  target: string;
  correlation_id?: string;
  timestamp: string;
}

export class MessageHandler {
  private isListening = false;
  private agentService: HederaAgentService;
  private toolCallingService: ToolCallingService;
  private hitlService: HitlService;

  constructor() {
    this.agentService = new HederaAgentService();
    this.toolCallingService = new ToolCallingService();
    this.hitlService = new HitlService();
  }

  async startListening(): Promise<void> {
    if (this.isListening) {
      console.log('Already listening to Redis channels');
      return;
    }

    try {
      const redisClient = getRedisClient();
      
      // Subscribe to command channel from Python service
      await redisClient.subscribe('hedera.agent.commands', (message) => {
        this.handleMessage(message);
      });

      // Subscribe to tool calling commands
      await redisClient.subscribe('hedera.tool.commands', (message) => {
        this.handleMessage(message);
      });

      // Subscribe to HITL commands
      await redisClient.subscribe('hedera.hitl.commands', (message) => {
        this.handleMessage(message);
      });

      this.isListening = true;
      console.log('✅ Started listening to hedera.agent.commands, hedera.tool.commands, and hedera.hitl.commands channels');
    } catch (error) {
      console.error('❌ Failed to start Redis message listener:', error);
      throw error;
    }
  }

  private async handleMessage(message: string): Promise<void> {
    try {
      const data: HederaAgentMessage = JSON.parse(message);
      console.log(`📨 Received message type: ${data.type} from ${data.source}`);

      // Route message based on type
      switch (data.type) {
        case 'ping':
          await this.handlePing(data);
          break;
          
        case 'test_connection':
          await this.handleTestConnection(data);
          break;

        // Agent Kit natural language processing
        case 'natural_language_request':
          await this.agentService.handleNaturalLanguageRequest(data);
          break;

        // HCS operations via Agent Kit
        case 'hcs_operation':
          await this.agentService.handleHcsOperation(data);
          break;

        // HTS operations via Agent Kit  
        case 'hts_operation':
          await this.agentService.handleHtsOperation(data);
          break;

        // Agent status
        case 'agent_status':
          await this.agentService.handleAgentStatus(data);
          break;

        // Direct tool calling operations
        case 'hcs_tool_call':
          await this.toolCallingService.handleHcsToolCall(data);
          break;

        case 'hts_tool_call':
          await this.toolCallingService.handleHtsToolCall(data);
          break;

        case 'hybrid_operation':
          await this.toolCallingService.handleHybridOperation(data);
          break;

        case 'tool_status':
          await this.toolCallingService.handleToolStatus(data);
          break;

        // Human-in-the-Loop operations
        case 'hitl_transaction_request':
          await this.hitlService.handleTransactionRequest(data);
          break;

        case 'hitl_approval_response':
          await this.hitlService.handleApprovalResponse(data);
          break;

        case 'hitl_emergency_override':
          await this.hitlService.handleEmergencyOverride(data);
          break;

        case 'hitl_status':
          await this.hitlService.handleApprovalStatus(data);
          break;
          
        // Legacy handlers (for backward compatibility)
        case 'hcs_log':
          await this.handleHCSLog(data);
          break;
          
        case 'hts_mint':
          await this.handleHTSMint(data);
          break;
          
        default:
          console.warn(`⚠️ Unknown message type: ${data.type}`);
          await this.sendErrorResponse(data, `Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
      
      try {
        const data = JSON.parse(message);
        await this.sendErrorResponse(data, `Message handling error: ${error}`);
      } catch (parseError) {
        console.error('❌ Additionally failed to parse message for error response');
      }
    }
  }

  private async handlePing(message: HederaAgentMessage): Promise<void> {
    console.log('🏓 Handling ping request');
    
    await publishToChannel('hedera.agent.responses', {
      type: 'ping_response',
      source: 'hedera-service',
      target: message.source,
      correlation_id: message.correlation_id,
      payload: {
        message: 'pong from TypeScript service',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async handleTestConnection(message: HederaAgentMessage): Promise<void> {
    console.log('🔍 Handling connection test request');
    
    // Mock successful connection test for now
    await publishToChannel('hedera.agent.responses', {
      type: 'test_connection_response',
      source: 'hedera-service',
      target: message.source,
      correlation_id: message.correlation_id,
      payload: {
        success: true,
        network: process.env.HEDERA_NETWORK || 'testnet',
        account_id: process.env.HEDERA_ACCOUNT_ID,
        status: 'connected',
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async handleHCSLog(message: HederaAgentMessage): Promise<void> {
    console.log('📝 Handling HCS log request (mock implementation)');
    
    // Mock HCS logging response for Story 1.1
    await publishToChannel('hedera.agent.responses', {
      type: 'hcs_log_response',
      source: 'hedera-service',
      target: message.source,
      correlation_id: message.correlation_id,
      payload: {
        success: true,
        topic_id: '0.0.123456',
        message_id: 'mock-hcs-message-id',
        consensus_timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async handleHTSMint(message: HederaAgentMessage): Promise<void> {
    console.log('🎫 Handling HTS mint request (mock implementation)');
    
    // Mock NFT minting response for Story 1.1
    await publishToChannel('hedera.agent.responses', {
      type: 'hts_mint_response',
      source: 'hedera-service',
      target: message.source,
      correlation_id: message.correlation_id,
      payload: {
        success: true,
        token_id: '0.0.789012',
        serial_number: 1,
        transaction_id: 'mock-transaction-id',
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async sendErrorResponse(originalMessage: HederaAgentMessage, error: string): Promise<void> {
    await publishToChannel('hedera.agent.responses', {
      type: 'error_response',
      source: 'hedera-service',
      target: originalMessage.source,
      correlation_id: originalMessage.correlation_id,
      payload: {
        success: false,
        error,
        original_type: originalMessage.type,
      },
      timestamp: new Date().toISOString(),
    });
  }

  async stopListening(): Promise<void> {
    // Cleanup code would go here
    this.isListening = false;
    console.log('📴 Stopped listening to Redis channels');
  }
}

export const messageHandler = new MessageHandler();