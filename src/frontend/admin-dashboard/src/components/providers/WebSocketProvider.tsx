/**
 * WebSocket provider component.
 */

import React, { useEffect } from 'react';
import { webSocketService } from '@services/websocket';

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  useEffect(() => {
    // Initialize WebSocket connection
    const initWebSocket = async () => {
      try {
        await webSocketService.connect();
      } catch (error) {
        console.warn('WebSocket connection failed:', error);
      }
    };

    initWebSocket();

    return () => {
      webSocketService.disconnect();
    };
  }, []);

  return <>{children}</>;
};