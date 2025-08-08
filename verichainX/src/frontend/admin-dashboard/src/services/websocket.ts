/**
 * WebSocket service for real-time dashboard updates.
 * 
 * This service manages WebSocket connections to receive real-time updates
 * for product status changes, agent activities, and system metrics.
 */

import {
  WebSocketMessage,
  DashboardUpdate,
  ActivityUpdate,
  AgentStatusUpdate,
  SystemEventUpdate,
  ProductStatusChange,
} from '@types';

export type WebSocketEventType = 
  | 'dashboard_update'
  | 'activity_update' 
  | 'agent_status_update'
  | 'system_event_update'
  | 'product_status_change';

export type WebSocketEventHandler<T = any> = (data: T) => void;

export interface WebSocketOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  debug?: boolean;
}

export enum WebSocketState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private options: Required<WebSocketOptions>;
  private eventHandlers: Map<WebSocketEventType, Set<WebSocketEventHandler>> = new Map();
  private state: WebSocketState = WebSocketState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private accessToken: string | null = null;

  constructor(options: WebSocketOptions = {}) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || window.location.host;
    this.url = `${wsProtocol}//${wsHost}/ws/dashboard`;
    
    this.options = {
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      debug: import.meta.env.DEV,
      ...options,
    };

    // Load access token from localStorage
    this.accessToken = localStorage.getItem('access_token');
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === WebSocketState.CONNECTED) {
        resolve();
        return;
      }

      this.setState(WebSocketState.CONNECTING);
      this.log('Connecting to WebSocket server...');

      try {
        // Add authentication token to URL if available
        const wsUrl = this.accessToken 
          ? `${this.url}?token=${this.accessToken}`
          : this.url;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.log('WebSocket connected');
          this.setState(WebSocketState.CONNECTED);
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          this.log(`WebSocket closed: ${event.code} ${event.reason}`);
          this.setState(WebSocketState.DISCONNECTED);
          this.stopHeartbeat();
          
          if (this.options.autoReconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.log('WebSocket error:', error);
          this.setState(WebSocketState.ERROR);
          reject(error);
        };

      } catch (error) {
        this.log('Failed to create WebSocket connection:', error);
        this.setState(WebSocketState.ERROR);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.options.autoReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState(WebSocketState.DISCONNECTED);
    this.log('WebSocket disconnected');
  }

  /**
   * Subscribe to a specific event type
   */
  on<T = any>(eventType: WebSocketEventType, handler: WebSocketEventHandler<T>): () => void {
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

  /**
   * Unsubscribe from an event type
   */
  off(eventType: WebSocketEventType, handler?: WebSocketEventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;

    if (handler) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    } else {
      this.eventHandlers.delete(eventType);
    }
  }

  /**
   * Send a message to the server
   */
  send(message: any): void {
    if (this.state !== WebSocketState.CONNECTED || !this.ws) {
      this.log('Cannot send message: WebSocket not connected');
      return;
    }

    try {
      const jsonMessage = JSON.stringify(message);
      this.ws.send(jsonMessage);
      this.log('Sent message:', message);
    } catch (error) {
      this.log('Failed to send message:', error);
    }
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === WebSocketState.CONNECTED;
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string | null): void {
    this.accessToken = token;
    
    // Reconnect with new token if currently connected
    if (this.isConnected()) {
      this.disconnect();
      setTimeout(() => this.connect(), 1000);
    }
  }

  /**
   * Subscribe to product status changes
   */
  onProductStatusChange(handler: WebSocketEventHandler<ProductStatusChange>): () => void {
    return this.on('product_status_change', handler);
  }

  /**
   * Subscribe to activity updates
   */
  onActivityUpdate(handler: WebSocketEventHandler<ActivityUpdate>): () => void {
    return this.on('activity_update', handler);
  }

  /**
   * Subscribe to agent status updates
   */
  onAgentStatusUpdate(handler: WebSocketEventHandler<AgentStatusUpdate>): () => void {
    return this.on('agent_status_update', handler);
  }

  /**
   * Subscribe to system events
   */
  onSystemEvent(handler: WebSocketEventHandler<SystemEventUpdate>): () => void {
    return this.on('system_event_update', handler);
  }

  /**
   * Subscribe to dashboard updates
   */
  onDashboardUpdate(handler: WebSocketEventHandler<DashboardUpdate>): () => void {
    return this.on('dashboard_update', handler);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      this.log('Received message:', message);

      // Handle heartbeat responses
      if (message.type === 'heartbeat_response') {
        this.log('Heartbeat acknowledged');
        return;
      }

      // Emit the message to registered handlers
      const handlers = this.eventHandlers.get(message.type as WebSocketEventType);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(message.data);
          } catch (error) {
            this.log('Error in event handler:', error);
          }
        });
      } else {
        this.log(`No handlers registered for event type: ${message.type}`);
      }

    } catch (error) {
      this.log('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Set connection state and notify listeners
   */
  private setState(newState: WebSocketState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.log(`State changed: ${oldState} -> ${newState}`);
      
      // Emit state change event
      const stateHandlers = this.eventHandlers.get('dashboard_update');
      if (stateHandlers) {
        const stateUpdate: DashboardUpdate = {
          type: 'dashboard_update',
          data: {
            update_type: 'system_metrics',
            payload: {
              websocket_state: newState,
              websocket_connected: newState === WebSocketState.CONNECTED,
            }
          },
          timestamp: new Date().toISOString(),
        };

        stateHandlers.forEach(handler => {
          try {
            handler(stateUpdate);
          } catch (error) {
            this.log('Error in state change handler:', error);
          }
        });
      }
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    this.log(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.setState(WebSocketState.RECONNECTING);

    this.reconnectTimer = setTimeout(() => {
      this.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`);
      this.connect().catch(() => {
        // Reconnection failed, will be handled by onclose event
      });
    }, delay);
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send({
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
        });
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Log debug messages
   */
  private log(...args: any[]): void {
    if (this.options.debug) {
      console.log('[WebSocket]', ...args);
    }
  }
}

// Create singleton instance
export const webSocketService = new WebSocketService();

// React hook for using WebSocket in components
export function useWebSocket() {
  return {
    connect: () => webSocketService.connect(),
    disconnect: () => webSocketService.disconnect(),
    isConnected: () => webSocketService.isConnected(),
    getState: () => webSocketService.getState(),
    onProductStatusChange: (handler: WebSocketEventHandler<ProductStatusChange>) => 
      webSocketService.onProductStatusChange(handler),
    onActivityUpdate: (handler: WebSocketEventHandler<ActivityUpdate>) => 
      webSocketService.onActivityUpdate(handler),
    onAgentStatusUpdate: (handler: WebSocketEventHandler<AgentStatusUpdate>) => 
      webSocketService.onAgentStatusUpdate(handler),
    onSystemEvent: (handler: WebSocketEventHandler<SystemEventUpdate>) => 
      webSocketService.onSystemEvent(handler),
    onDashboardUpdate: (handler: WebSocketEventHandler<DashboardUpdate>) => 
      webSocketService.onDashboardUpdate(handler),
  };
}

export default webSocketService;