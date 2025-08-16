/**
 * Application routing configuration.
 */

import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { DashboardLayout } from '@components/layout/DashboardLayout';

// Lazy load pages for code splitting
const Dashboard = lazy(() => import('@components/dashboard/Dashboard').then(m => ({ default: m.Dashboard })));
const ActivityPage = lazy(() => import('@components/activity/ActivityPage').then(m => ({ default: m.ActivityPage })));
const ProductsPage = lazy(() => import('@components/products/ProductsPage').then(m => ({ default: m.ProductsPage })));
const ProductCatalog = lazy(() => import('@components/products/ProductCatalog').then(m => ({ default: m.ProductCatalog })));
const QRVerificationPage = lazy(() => import('@components/qr/QRVerificationPage').then(m => ({ default: m.QRVerificationPage })));
const AnalyticsPage = lazy(() => import('@components/analytics/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout><Dashboard /></DashboardLayout>} />
      <Route path="/activity" element={<DashboardLayout><ActivityPage /></DashboardLayout>} />
      <Route path="/products" element={<DashboardLayout><ProductsPage /></DashboardLayout>} />
      <Route path="/catalog" element={<ProductCatalog />} />
      <Route path="/verify" element={<QRVerificationPage />} />
      <Route path="/analytics" element={<DashboardLayout><AnalyticsPage /></DashboardLayout>} />
      <Route path="*" element={<DashboardLayout><Dashboard /></DashboardLayout>} />
    </Routes>
  );
};