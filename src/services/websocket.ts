/**
 * WebSocket Service for Real-time Updates
 * 
 * Connects to VeriChain X WebSocket for live data updates
 */

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

export interface SystemUpdate {
  totalScanned?: number;
  counterfeitsDetected?: number;
  accuracyRate?: number;
  activeAgents?: number;
}

export interface AgentUpdate {
  agentId: string;
  status: 'active' | 'idle' | 'processing' | 'error';
  lastActivity: string;
}

export interface TransactionUpdate {
  id: string;
  type: 'verification' | 'nft_mint' | 'audit_log';
  product: string;
  status: 'verified' | 'pending' | 'complete';
  txHash: string;
}

export type WebSocketEventHandler<T = any> = (data: T) => void;

class VeriChainXWebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 5000;
  private eventHandlers: Map<string, Set<WebSocketEventHandler>> = new Map();

  constructor() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || window.location.host;
    this.url = `${wsProtocol}//${wsHost}/ws/dashboard`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Add auth token if available
        const token = localStorage.getItem('access_token');
        const wsUrl = token ? `${this.url}?token=${token}` : this.url;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected to VeriChain X');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on<T = any>(eventType: string, handler: WebSocketEventHandler<T>): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }

    this.eventHandlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.eventHandlers.delete(eventType);
        }
      }
    };
  }

  // Specific event subscriptions
  onSystemUpdate(handler: WebSocketEventHandler<SystemUpdate>): () => void {
    return this.on('system_update', handler);
  }

  onAgentUpdate(handler: WebSocketEventHandler<AgentUpdate>): () => void {
    return this.on('agent_update', handler);
  }

  onTransactionUpdate(handler: WebSocketEventHandler<TransactionUpdate>): () => void {
    return this.on('transaction_update', handler);
  }

  onDetectionAlert(handler: WebSocketEventHandler<any>): () => void {
    return this.on('detection_alert', handler);
  }

  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      
      const handlers = this.eventHandlers.get(message.type);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(message.data);
          } catch (error) {
            console.error('Error in WebSocket event handler:', error);
          }
        });
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.connect().catch(() => {
        // Will be handled by onclose event
      });
    }, delay);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Create singleton instance
export const webSocketService = new VeriChainXWebSocketService();
export default webSocketService;