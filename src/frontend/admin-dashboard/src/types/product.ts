/**
 * Product-related TypeScript types for the admin dashboard.
 * 
 * This module defines all product data structures used throughout
 * the counterfeit detection dashboard interface.
 */

export enum ProductStatus {
  ACTIVE = 'active',
  FLAGGED = 'flagged',
  PAUSED = 'paused',
  REMOVED = 'removed',
  UNDER_REVIEW = 'under_review',
  REINSTATED = 'reinstated',
}

export enum ProductCategory {
  LUXURY_GOODS = 'luxury_goods',
  ELECTRONICS = 'electronics',
  CLOTHING = 'clothing',
  JEWELRY = 'jewelry',
  COSMETICS = 'cosmetics',
  PHARMACEUTICALS = 'pharmaceuticals',
  AUTOMOTIVE = 'automotive',
  HOME_GARDEN = 'home_garden',
  TOYS = 'toys',
  SPORTS = 'sports',
  OTHER = 'other',
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ProductImage {
  id: string;
  url: string;
  thumbnail_url: string;
  caption?: string;
  analysis_results?: {
    similarity_score?: number;
    flagged_features?: string[];
  };
}

export interface ProductDetails {
  id: string;
  title: string;
  description: string;
  category: ProductCategory;
  status: ProductStatus;
  supplier_id: string;
  supplier_name: string;
  platform: string;
  platform_product_id: string;
  
  // Pricing information
  price: number;
  currency: string;
  original_price?: number;
  
  // Product metadata
  brand?: string;
  model?: string;
  sku?: string;
  gtin?: string;
  
  // Images and media
  images: ProductImage[];
  
  // Analysis results
  authenticity_score: number;
  confidence_score: number;
  risk_level: RiskLevel;
  last_analyzed_at: string;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  
  // Additional metadata
  metadata?: Record<string, any>;
}

export interface ProductSummary {
  id: string;
  title: string;
  category: ProductCategory;
  status: ProductStatus;
  supplier_name: string;
  authenticity_score: number;
  risk_level: RiskLevel;
  thumbnail_url?: string;
  flagged_at?: string;
  last_action?: string;
}

export interface ProductFilters {
  status?: ProductStatus[];
  category?: ProductCategory[];
  supplier_ids?: string[];
  risk_levels?: RiskLevel[];
  score_range?: {
    min: number;
    max: number;
  };
  time_range?: {
    start: Date;
    end: Date;
    preset?: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
  };
  search_query?: string;
  platform?: string[];
  brand?: string[];
  price_range?: {
    min: number;
    max: number;
    currency?: string;
  };
}

export interface ProductPage {
  products: ProductSummary[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface ProductAnalysisResult {
  id: string;
  product_id: string;
  analysis_type: 'authenticity' | 'similarity' | 'rule_evaluation';
  agent_id: string;
  agent_name: string;
  
  // Analysis input and output
  input_data: Record<string, any>;
  output_data: Record<string, any>;
  
  // Scoring
  authenticity_score: number;
  confidence_score: number;
  risk_assessment: RiskLevel;
  
  // Analysis details
  reasoning: string;
  evidence: string[];
  similar_products?: {
    product_id: string;
    similarity_score: number;
    comparison_results: Record<string, any>;
  }[];
  
  // Processing metadata
  processing_time_ms: number;
  model_version: string;
  timestamp: string;
}

export interface ProductRuleMatch {
  id: string;
  product_id: string;
  rule_id: string;
  rule_name: string;
  rule_category: string;
  
  // Match details
  match_score: number;
  match_reasoning: string;
  triggered_action?: string;
  
  // Rule configuration
  rule_threshold: number;
  rule_priority: number;
  
  // Timestamps
  matched_at: string;
}

export interface ProductEnforcementAction {
  id: string;
  product_id: string;
  action_type: string;
  status: 'pending' | 'completed' | 'failed' | 'rolled_back';
  
  // Action details
  reasoning: string;
  executed_by: string;
  execution_timestamp: string;
  
  // Platform response
  platform_response?: Record<string, any>;
  
  // Appeal information
  appeal_status?: 'none' | 'submitted' | 'under_review' | 'approved' | 'denied';
  appeal_id?: string;
}

export interface ProductTraceability {
  product: ProductDetails;
  analysis_history: ProductAnalysisResult[];
  rule_matches: ProductRuleMatch[];
  enforcement_actions: ProductEnforcementAction[];
  similar_products: {
    product_id: string;
    product_title: string;
    similarity_score: number;
    comparison_results: Record<string, any>;
  }[];
  supplier_history: {
    reputation_score: number;
    violation_count: number;
    total_products: number;
    recent_actions: ProductEnforcementAction[];
  };
}

export interface ProductStatusChange {
  product_id: string;
  old_status: ProductStatus;
  new_status: ProductStatus;
  reason: string;
  timestamp: string;
  initiated_by: string;
}

export interface ProductMetrics {
  total_products: number;
  products_by_status: Record<ProductStatus, number>;
  products_by_category: Record<ProductCategory, number>;
  products_by_risk_level: Record<RiskLevel, number>;
  
  // Time-based metrics
  flagged_today: number;
  flagged_this_week: number;
  flagged_this_month: number;
  
  // Score distribution
  score_distribution: {
    range: string;
    count: number;
    percentage: number;
  }[];
  
  // Trends
  detection_trend: {
    date: string;
    flagged_count: number;
    total_analyzed: number;
    detection_rate: number;
  }[];
}

// Export helper functions
export const getStatusColor = (status: ProductStatus): string => {
  switch (status) {
    case ProductStatus.ACTIVE:
      return '#4caf50'; // green
    case ProductStatus.FLAGGED:
      return '#ff9800'; // orange
    case ProductStatus.PAUSED:
      return '#2196f3'; // blue
    case ProductStatus.REMOVED:
      return '#f44336'; // red
    case ProductStatus.UNDER_REVIEW:
      return '#9c27b0'; // purple
    case ProductStatus.REINSTATED:
      return '#00bcd4'; // cyan
    default:
      return '#757575'; // grey
  }
};

export const getRiskLevelColor = (riskLevel: RiskLevel): string => {
  switch (riskLevel) {
    case RiskLevel.LOW:
      return '#4caf50'; // green
    case RiskLevel.MEDIUM:
      return '#ff9800'; // orange
    case RiskLevel.HIGH:
      return '#ff5722'; // deep orange
    case RiskLevel.CRITICAL:
      return '#d32f2f'; // red
    default:
      return '#757575'; // grey
  }
};

export const formatScore = (score: number): string => {
  return `${Math.round(score)}%`;
};

export const getScoreColor = (score: number): string => {
  if (score >= 80) return '#4caf50'; // green - authentic
  if (score >= 60) return '#8bc34a'; // light green
  if (score >= 40) return '#ff9800'; // orange - suspicious
  if (score >= 20) return '#ff5722'; // deep orange
  return '#f44336'; // red - likely counterfeit
};