/**
 * Human-in-the-Loop Service
 * Integrates HITL agent with tool calling operations
 */

import { HumanInTheLoopAgent, TransactionRequest, ApprovalRequest } from '../agents/HumanInTheLoopAgent';
import ToolCallingService from './toolCallingService';
import { publishToChannel } from '../config/redis';

interface HitlMessage {
  type: string;
  source: string;
  correlation_id?: string;
  payload: any;
  timestamp: string;
}

interface HitlResponse {
  type: string;
  source: string;
  correlation_id?: string;
  payload: any;
  timestamp: string;
}

export class HitlService {
  private hitlAgent: HumanInTheLoopAgent;
  private toolCallingService: ToolCallingService;
  private pendingTransactions: Map<string, any> = new Map();

  constructor() {
    this.hitlAgent = new HumanInTheLoopAgent();
    this.toolCallingService = new ToolCallingService();
    console.log('🛡️ HITL Service initialized');
  }

  /**
   * Process transaction request through HITL workflow
   */
  async handleTransactionRequest(message: HitlMessage): Promise<void> {
    try {
      const { operation, payload, estimatedValue } = message.payload;

      // Create transaction request
      const transactionRequest: Omit<TransactionRequest, 'id' | 'requiresApproval' | 'riskLevel'> = {
        type: this.determineTransactionType(operation),
        operation,
        payload,
        estimatedValue: estimatedValue || this.estimateTransactionValue(operation, payload),
        requestedBy: message.source,
        timestamp: message.timestamp,
      };

      // Assess transaction
      const assessedTransaction = this.hitlAgent.assessTransaction(transactionRequest);

      // Store original message for later execution
      this.pendingTransactions.set(assessedTransaction.id, {
        originalMessage: message,
        assessedTransaction,
      });

      // Process through HITL
      const result = await this.hitlAgent.processTransaction(assessedTransaction);

      if (result.executeImmediately) {
        // Execute immediately (low risk, approved automatically)
        await this.executeTransaction(assessedTransaction.id);
      } else {
        // Send approval required response
        await this.sendResponse(message, 'hitl_approval_required', {
          transactionId: assessedTransaction.id,
          approvalId: result.approvalId,
          message: result.message,
          riskLevel: assessedTransaction.riskLevel,
          estimatedValue: assessedTransaction.estimatedValue,
          summary: this.generateTransactionSummary(assessedTransaction),
        });
      }

    } catch (error) {
      console.error('Error handling HITL transaction request:', error);
      await this.sendErrorResponse(message, `HITL processing failed: ${error.message}`);
    }
  }

  /**
   * Handle approval response from human
   */
  async handleApprovalResponse(message: HitlMessage): Promise<void> {
    try {
      const { transactionId, approved, approver, reason } = message.payload;

      const result = await this.hitlAgent.handleApprovalResponse(
        transactionId,
        approved,
        approver,
        reason
      );

      if (result.success && result.canProceed) {
        // Execute the approved transaction
        await this.executeTransaction(transactionId);
      }

      await this.sendResponse(message, 'hitl_approval_processed', {
        transactionId,
        success: result.success,
        message: result.message,
        canProceed: result.canProceed,
        status: approved ? 'approved' : 'rejected',
      });

    } catch (error) {
      console.error('Error handling approval response:', error);
      await this.sendErrorResponse(message, `Approval processing failed: ${error.message}`);
    }
  }

  /**
   * Handle emergency override
   */
  async handleEmergencyOverride(message: HitlMessage): Promise<void> {
    try {
      const { transactionId, reason, overrideBy } = message.payload;

      const success = this.hitlAgent.emergencyOverride(transactionId, reason, overrideBy);

      if (success) {
        // Execute the overridden transaction
        await this.executeTransaction(transactionId);
      }

      await this.sendResponse(message, 'hitl_emergency_override_result', {
        transactionId,
        success,
        message: success 
          ? 'Emergency override applied and transaction executed'
          : 'Emergency override failed',
        overrideBy,
        reason,
      });

    } catch (error) {
      console.error('Error handling emergency override:', error);
      await this.sendErrorResponse(message, `Emergency override failed: ${error.message}`);
    }
  }

  /**
   * Get approval status
   */
  async handleApprovalStatus(message: HitlMessage): Promise<void> {
    try {
      const { transactionId, includePending, includeHistory } = message.payload;

      let status: any = {};

      if (transactionId) {
        // Get specific transaction status
        const pending = this.hitlAgent.getPendingApprovals()
          .find(a => a.transactionId === transactionId);
        const history = this.hitlAgent.getApprovalHistory()
          .find(a => a.transactionId === transactionId);

        status = {
          transactionId,
          found: !!(pending || history),
          status: pending ? 'pending' : history?.status || 'not_found',
          details: pending || history,
        };
      } else {
        // Get general status
        status = {
          pending: includePending ? this.hitlAgent.getPendingApprovals() : [],
          history: includeHistory ? this.hitlAgent.getApprovalHistory(50) : [],
          config: this.hitlAgent.getConfig(),
          stats: {
            pendingCount: this.hitlAgent.getPendingApprovals().length,
            historyCount: this.hitlAgent.getApprovalHistory().length,
          },
        };
      }

      await this.sendResponse(message, 'hitl_status_response', status);

    } catch (error) {
      console.error('Error getting approval status:', error);
      await this.sendErrorResponse(message, `Status retrieval failed: ${error.message}`);
    }
  }

  /**
   * Execute approved transaction
   */
  private async executeTransaction(transactionId: string): Promise<void> {
    const pendingData = this.pendingTransactions.get(transactionId);
    if (!pendingData) {
      console.error(`❌ Cannot execute transaction ${transactionId}: Not found in pending transactions`);
      return;
    }

    const { originalMessage, assessedTransaction } = pendingData;

    try {
      console.log(`🚀 Executing approved transaction ${transactionId}: ${assessedTransaction.operation}`);

      // Route to appropriate service based on transaction type
      switch (assessedTransaction.type) {
        case 'hcs':
          await this.toolCallingService.handleHcsToolCall(originalMessage);
          break;
        case 'hts':
          await this.toolCallingService.handleHtsToolCall(originalMessage);
          break;
        case 'hybrid':
          await this.toolCallingService.handleHybridOperation(originalMessage);
          break;
        default:
          throw new Error(`Unknown transaction type: ${assessedTransaction.type}`);
      }

      // Clean up
      this.pendingTransactions.delete(transactionId);

      console.log(`✅ Transaction ${transactionId} executed successfully`);

    } catch (error) {
      console.error(`❌ Failed to execute transaction ${transactionId}:`, error);
      
      // Notify execution failure
      await publishToChannel('hedera.hitl.execution_failed', {
        type: 'transaction_execution_failed',
        source: 'hitl-service',
        payload: {
          transactionId,
          error: error.message,
          transaction: assessedTransaction,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Determine transaction type from operation
   */
  private determineTransactionType(operation: string): 'hcs' | 'hts' | 'hybrid' {
    if (operation.includes('topic') || operation.includes('hcs')) {
      return 'hcs';
    }
    if (operation.includes('token') || operation.includes('hbar') || operation.includes('nft')) {
      return 'hts';
    }
    if (operation.includes('certificate') || operation.includes('authenticity')) {
      return 'hybrid';
    }
    return 'hts'; // Default to HTS
  }

  /**
   * Estimate transaction value for risk assessment
   */
  private estimateTransactionValue(operation: string, payload: any): TransactionRequest['estimatedValue'] {
    const estimatedValue: TransactionRequest['estimatedValue'] = {};

    // HBAR transfers
    if (operation === 'transfer_hbar' && payload.amount) {
      estimatedValue.hbar = payload.amount;
      estimatedValue.usd = payload.amount * 0.05; // Rough HBAR to USD conversion
    }

    // Token transfers
    if (operation === 'transfer_token' && payload.amount) {
      estimatedValue.tokens = [{
        tokenId: payload.tokenId,
        amount: payload.amount,
        symbol: payload.symbol,
      }];
    }

    // Token creation (consider initial supply value)
    if (operation === 'create_fungible_token' && payload.initialSupply) {
      estimatedValue.tokens = [{
        tokenId: 'new-token',
        amount: payload.initialSupply,
        symbol: payload.symbol,
      }];
    }

    // NFT operations (assign standard value)
    if (operation.includes('nft') || operation === 'mint_nft') {
      estimatedValue.usd = 100; // Assume $100 value for NFTs
    }

    return estimatedValue;
  }

  /**
   * Generate human-readable transaction summary
   */
  private generateTransactionSummary(transaction: TransactionRequest): string {
    return `${transaction.operation} requested by ${transaction.requestedBy} with ${transaction.riskLevel} risk level`;
  }

  /**
   * Send successful response
   */
  private async sendResponse(
    originalMessage: HitlMessage,
    responseType: string,
    payload: any
  ): Promise<void> {
    const response: HitlResponse = {
      type: responseType,
      source: 'hitl-service',
      correlation_id: originalMessage.correlation_id,
      payload,
      timestamp: new Date().toISOString(),
    };

    await publishToChannel('hedera.hitl.responses', response);
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(originalMessage: HitlMessage, error: string): Promise<void> {
    const response: HitlResponse = {
      type: 'hitl_error_response',
      source: 'hitl-service',
      correlation_id: originalMessage.correlation_id,
      payload: {
        success: false,
        error,
        originalMessage: originalMessage.type,
      },
      timestamp: new Date().toISOString(),
    };

    await publishToChannel('hedera.hitl.responses', response);
  }

  /**
   * Get service status
   */
  getStatus(): { initialized: boolean; pendingTransactions: number; pendingApprovals: number } {
    return {
      initialized: true,
      pendingTransactions: this.pendingTransactions.size,
      pendingApprovals: this.hitlAgent.getPendingApprovals().length,
    };
  }
}

export default HitlService;