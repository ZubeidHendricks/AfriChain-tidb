/**
 * Human-in-the-Loop (HITL) Agent
 * Provides safety layer for high-value transactions requiring human approval
 */

import { publishToChannel } from '../config/redis';
import { z } from 'zod';

export interface TransactionRequest {
  id: string;
  type: 'hcs' | 'hts' | 'hybrid';
  operation: string;
  payload: any;
  estimatedValue: {
    hbar?: number;
    usd?: number;
    tokens?: Array<{ tokenId: string; amount: number; symbol?: string }>;
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  requestedBy: string;
  timestamp: string;
}

export interface ApprovalRequest {
  transactionId: string;
  summary: string;
  details: TransactionRequest;
  approvalDeadline: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  approvalTimestamp?: string;
  rejectionReason?: string;
}

export interface HitlConfig {
  thresholdHbar: number;
  thresholdUsd: number;
  requireApprovalForOperations: string[];
  approvalTimeoutMinutes: number;
  approvers: string[];
  emergencyOverride: boolean;
}

export class HumanInTheLoopAgent {
  private config: HitlConfig;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private approvalHistory: ApprovalRequest[] = [];

  constructor(config?: Partial<HitlConfig>) {
    this.config = {
      thresholdHbar: parseFloat(process.env.HILT_THRESHOLD_HBAR || '100'),
      thresholdUsd: parseFloat(process.env.HILT_THRESHOLD_USD || '1000'),
      requireApprovalForOperations: [
        'create_token',
        'mint_token',
        'transfer_token',
        'transfer_hbar',
        'create_authenticity_certificate',
        'verify_product_authenticity'
      ],
      approvalTimeoutMinutes: parseInt(process.env.HILT_TIMEOUT_MINUTES || '30'),
      approvers: (process.env.HILT_APPROVERS || 'admin@verichainx.com').split(','),
      emergencyOverride: process.env.HILT_EMERGENCY_OVERRIDE === 'true',
      ...config,
    };

    console.log('🛡️ Human-in-the-Loop Agent initialized with config:', {
      thresholdHbar: this.config.thresholdHbar,
      thresholdUsd: this.config.thresholdUsd,
      approvalTimeoutMinutes: this.config.approvalTimeoutMinutes,
      approvers: this.config.approvers.length,
    });
  }

  /**
   * Assess if a transaction requires human approval
   */
  assessTransaction(request: Omit<TransactionRequest, 'id' | 'requiresApproval' | 'riskLevel'>): TransactionRequest {
    const transactionId = this.generateTransactionId();
    
    // Assess risk level
    const riskLevel = this.assessRiskLevel(request);
    
    // Determine if approval is required
    const requiresApproval = this.requiresApproval(request, riskLevel);

    const transaction: TransactionRequest = {
      ...request,
      id: transactionId,
      riskLevel,
      requiresApproval,
    };

    console.log(`🔍 Transaction ${transactionId} assessed:`, {
      operation: request.operation,
      riskLevel,
      requiresApproval,
      estimatedValue: request.estimatedValue,
    });

    return transaction;
  }

  /**
   * Process transaction through HITL workflow
   */
  async processTransaction(transaction: TransactionRequest): Promise<{
    approved: boolean;
    message: string;
    approvalId?: string;
    executeImmediately?: boolean;
  }> {
    if (!transaction.requiresApproval) {
      return {
        approved: true,
        message: 'Transaction approved automatically (below thresholds)',
        executeImmediately: true,
      };
    }

    // Create approval request
    const approvalRequest: ApprovalRequest = {
      transactionId: transaction.id,
      summary: this.generateTransactionSummary(transaction),
      details: transaction,
      approvalDeadline: new Date(
        Date.now() + this.config.approvalTimeoutMinutes * 60 * 1000
      ).toISOString(),
      status: 'pending',
    };

    // Store pending approval
    this.pendingApprovals.set(transaction.id, approvalRequest);

    // Send approval request to human approvers
    await this.sendApprovalRequest(approvalRequest);

    return {
      approved: false,
      message: `Transaction requires human approval. Request sent to ${this.config.approvers.length} approver(s).`,
      approvalId: transaction.id,
      executeImmediately: false,
    };
  }

  /**
   * Handle approval/rejection from human
   */
  async handleApprovalResponse(
    transactionId: string,
    approved: boolean,
    approver: string,
    reason?: string
  ): Promise<{
    success: boolean;
    message: string;
    canProceed?: boolean;
  }> {
    const approvalRequest = this.pendingApprovals.get(transactionId);
    
    if (!approvalRequest) {
      return {
        success: false,
        message: 'Approval request not found or already processed',
      };
    }

    // Check if deadline has passed
    if (new Date() > new Date(approvalRequest.approvalDeadline)) {
      approvalRequest.status = 'expired';
      this.pendingApprovals.delete(transactionId);
      this.approvalHistory.push(approvalRequest);
      
      return {
        success: false,
        message: 'Approval request has expired',
      };
    }

    // Update approval request
    if (approved) {
      approvalRequest.status = 'approved';
      approvalRequest.approvedBy = approver;
      approvalRequest.approvalTimestamp = new Date().toISOString();
    } else {
      approvalRequest.status = 'rejected';
      approvalRequest.rejectionReason = reason || 'No reason provided';
      approvalRequest.approvedBy = approver;
      approvalRequest.approvalTimestamp = new Date().toISOString();
    }

    // Remove from pending and add to history
    this.pendingApprovals.delete(transactionId);
    this.approvalHistory.push(approvalRequest);

    // Notify transaction result
    await this.notifyApprovalResult(approvalRequest);

    return {
      success: true,
      message: approved ? 'Transaction approved by human' : 'Transaction rejected by human',
      canProceed: approved,
    };
  }

  /**
   * Assess risk level of transaction
   */
  private assessRiskLevel(request: Omit<TransactionRequest, 'id' | 'requiresApproval' | 'riskLevel'>): 'low' | 'medium' | 'high' | 'critical' {
    const { estimatedValue, operation, type } = request;

    // Critical operations
    if (['create_token', 'mint_token'].includes(operation)) {
      return 'critical';
    }

    // High-value transactions
    if (estimatedValue.hbar && estimatedValue.hbar > this.config.thresholdHbar * 5) {
      return 'high';
    }
    if (estimatedValue.usd && estimatedValue.usd > this.config.thresholdUsd * 5) {
      return 'high';
    }

    // Medium-value transactions
    if (estimatedValue.hbar && estimatedValue.hbar > this.config.thresholdHbar) {
      return 'medium';
    }
    if (estimatedValue.usd && estimatedValue.usd > this.config.thresholdUsd) {
      return 'medium';
    }

    // Hybrid operations are medium risk by default
    if (type === 'hybrid') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Determine if transaction requires approval
   */
  private requiresApproval(
    request: Omit<TransactionRequest, 'id' | 'requiresApproval' | 'riskLevel'>,
    riskLevel: string
  ): boolean {
    // Always require approval for critical risk
    if (riskLevel === 'critical') {
      return true;
    }

    // Require approval for specific operations
    if (this.config.requireApprovalForOperations.includes(request.operation)) {
      if (riskLevel === 'medium' || riskLevel === 'high') {
        return true;
      }
    }

    // Require approval based on value thresholds
    if (request.estimatedValue.hbar && request.estimatedValue.hbar >= this.config.thresholdHbar) {
      return true;
    }
    if (request.estimatedValue.usd && request.estimatedValue.usd >= this.config.thresholdUsd) {
      return true;
    }

    return false;
  }

  /**
   * Generate transaction summary for human review
   */
  private generateTransactionSummary(transaction: TransactionRequest): string {
    const { operation, type, estimatedValue } = transaction;
    
    let summary = `${type.toUpperCase()} Operation: ${operation}`;
    
    if (estimatedValue.hbar) {
      summary += ` | Value: ${estimatedValue.hbar} HBAR`;
    }
    if (estimatedValue.usd) {
      summary += ` | ~$${estimatedValue.usd} USD`;
    }
    if (estimatedValue.tokens && estimatedValue.tokens.length > 0) {
      const tokenSummary = estimatedValue.tokens
        .map(t => `${t.amount} ${t.symbol || t.tokenId}`)
        .join(', ');
      summary += ` | Tokens: ${tokenSummary}`;
    }
    
    summary += ` | Risk: ${transaction.riskLevel.toUpperCase()}`;
    
    return summary;
  }

  /**
   * Send approval request to human approvers
   */
  private async sendApprovalRequest(approval: ApprovalRequest): Promise<void> {
    const approvalMessage = {
      type: 'human_approval_request',
      source: 'hitl-agent',
      payload: {
        approvalId: approval.transactionId,
        summary: approval.summary,
        details: approval.details,
        deadline: approval.approvalDeadline,
        approvers: this.config.approvers,
        actions: ['approve', 'reject'],
      },
      timestamp: new Date().toISOString(),
    };

    // Send to approval notification channel
    await publishToChannel('hedera.hitl.approval_requests', approvalMessage);

    console.log(`📋 Approval request sent for transaction ${approval.transactionId}`);
  }

  /**
   * Notify approval result
   */
  private async notifyApprovalResult(approval: ApprovalRequest): Promise<void> {
    const resultMessage = {
      type: 'human_approval_result',
      source: 'hitl-agent',
      payload: {
        transactionId: approval.transactionId,
        status: approval.status,
        approvedBy: approval.approvedBy,
        timestamp: approval.approvalTimestamp,
        canProceed: approval.status === 'approved',
        rejectionReason: approval.rejectionReason,
      },
      timestamp: new Date().toISOString(),
    };

    // Send result back to requesting service
    await publishToChannel('hedera.hitl.approval_results', resultMessage);

    console.log(`✅ Approval result sent for transaction ${approval.transactionId}: ${approval.status}`);
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `hitl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get pending approvals
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Get approval history
   */
  getApprovalHistory(limit?: number): ApprovalRequest[] {
    return limit 
      ? this.approvalHistory.slice(-limit)
      : this.approvalHistory;
  }

  /**
   * Get configuration
   */
  getConfig(): HitlConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<HitlConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log('🔧 HITL configuration updated:', updates);
  }

  /**
   * Emergency override (bypass approval for critical situations)
   */
  emergencyOverride(transactionId: string, reason: string, overrideBy: string): boolean {
    if (!this.config.emergencyOverride) {
      console.warn('❌ Emergency override disabled');
      return false;
    }

    const approval = this.pendingApprovals.get(transactionId);
    if (!approval) {
      console.warn('❌ Emergency override failed: Transaction not found');
      return false;
    }

    // Force approve
    approval.status = 'approved';
    approval.approvedBy = `EMERGENCY_OVERRIDE:${overrideBy}`;
    approval.approvalTimestamp = new Date().toISOString();
    approval.rejectionReason = `Emergency override: ${reason}`;

    this.pendingApprovals.delete(transactionId);
    this.approvalHistory.push(approval);

    console.warn(`⚠️ EMERGENCY OVERRIDE applied to transaction ${transactionId} by ${overrideBy}: ${reason}`);
    
    return true;
  }
}

/**
 * Validation schemas for HITL operations
 */
export const hitlSchemas = {
  transactionRequest: z.object({
    type: z.enum(['hcs', 'hts', 'hybrid']),
    operation: z.string(),
    payload: z.any(),
    estimatedValue: z.object({
      hbar: z.number().optional(),
      usd: z.number().optional(),
      tokens: z.array(z.object({
        tokenId: z.string(),
        amount: z.number(),
        symbol: z.string().optional(),
      })).optional(),
    }),
    requestedBy: z.string(),
    timestamp: z.string(),
  }),

  approvalResponse: z.object({
    transactionId: z.string(),
    approved: z.boolean(),
    approver: z.string().email(),
    reason: z.string().optional(),
  }),

  emergencyOverride: z.object({
    transactionId: z.string(),
    reason: z.string().min(10),
    overrideBy: z.string(),
  }),
};