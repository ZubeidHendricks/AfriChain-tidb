/**
 * Notification provider component - placeholder.
 */

import React from 'react';

interface NotificationProviderProps {
  children: React.ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  return <>{children}</>;
};