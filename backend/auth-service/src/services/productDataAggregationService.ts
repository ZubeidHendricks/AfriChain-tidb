/**
 * Product Data Aggregation Service
 * 
 * This service aggregates comprehensive product data including product details,
 * artisan profiles, verification history, and related metadata for verification
 * results display.
 */

import { getProductById } from '../models/Product';
import { getNftTokenByProductId } from '../models/Nft';
import Database from '../config/database';

export interface AggregatedProductData {
  product: {
    id: string;
    product_name: string;
    description: string;
    brand: string;
    category: string;
    manufacturer_name: string;
    origin_country: string;
    created_at: string;
    status: string;
    images?: string[];
    specifications?: Record<string, any>;
    quality_certifications?: string[];
    sustainability_score?: number;
  };
  artisan?: {
    id: string;
    name: string;
    bio: string;
    location: string;
    specialization: string;
    experience_years: number;
    rating: number;
    verified: boolean;
    avatar_url?: string;
    craft_story?: string;
    contact_info?: {
      website?: string;
      social_media?: Record<string, string>;
    };
    certifications?: string[];
    portfolio_items?: Array<{
      id: string;
      title: string;
      image_url: string;
      description: string;
    }>;
  };
  nft?: {
    token_id: string;
    serial_number: number;
    metadata_hash: string;
    minting_timestamp: string;
    current_owner: string;
    transaction_count: number;
    last_transfer_date?: string;
  };
  verificationHistory: {
    total_verifications: number;
    last_verification: string;
    authenticity_rate: number;
    geographic_distribution: Record<string, number>;
    verification_trend: Array<{
      date: string;
      count: number;
      authenticity_percentage: number;
    }>;
    recent_verifications: Array<{
      timestamp: string;
      result: 'authentic' | 'counterfeit' | 'suspicious';
      location?: string;
      verification_score: number;
    }>;
  };
  supplyChain?: {
    stages: Array<{
      stage_name: string;
      timestamp: string;
      location: string;
      responsible_party: string;
      verification_status: 'verified' | 'pending' | 'failed';
      documentation_url?: string;
    }>;
    origin_verification: {
      verified: boolean;
      documentation: string[];
      certificates: string[];
    };
    sustainability_metrics: {
      carbon_footprint?: number;
      fair_trade_certified?: boolean;
      organic_certified?: boolean;
      recycled_materials_percentage?: number;
    };
  };
  relatedProducts?: Array<{
    id: string;
    name: string;
    image_url: string;
    relationship: 'same_artisan' | 'same_category' | 'same_brand';
    authenticity_score: number;
  }>;
  marketInsights?: {
    average_verification_score: number;
    market_authenticity_rate: number;
    price_range: {
      min: number;
      max: number;
      currency: string;
    };
    demand_trend: 'increasing' | 'stable' | 'decreasing';
    counterfeit_risk_level: 'low' | 'medium' | 'high';
  };
}

export interface VerificationHistoryEntry {
  id: string;
  product_id: string;
  verification_timestamp: string;
  result: 'authentic' | 'counterfeit' | 'suspicious';
  verification_score: number;
  client_location?: string;
  user_agent?: string;
  warnings: string[];
  errors: string[];
}

export class ProductDataAggregationService {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  /**
   * Get comprehensive product data for verification results
   */
  async getAggregatedProductData(productId: string): Promise<AggregatedProductData | null> {
    try {
      // Get core product information
      const product = await this.getEnhancedProductInfo(productId);
      if (!product) {
        return null;
      }

      // Get all related data in parallel
      const [
        artisan,
        nft,
        verificationHistory,
        supplyChain,
        relatedProducts,
        marketInsights
      ] = await Promise.all([
        this.getArtisanProfile(productId),
        this.getNFTDetails(productId),
        this.getVerificationHistory(productId),
        this.getSupplyChainData(productId),
        this.getRelatedProducts(productId),
        this.getMarketInsights(productId)
      ]);

      return {
        product,
        artisan,
        nft,
        verificationHistory,
        supplyChain,
        relatedProducts,
        marketInsights,
      };

    } catch (error) {
      console.error('Failed to aggregate product data:', error);
      throw new Error('Product data aggregation failed');
    }
  }

  /**
   * Get enhanced product information with additional metadata
   */
  private async getEnhancedProductInfo(productId: string): Promise<AggregatedProductData['product'] | null> {
    try {
      const product = await getProductById(productId);
      if (!product) {
        return null;
      }

      // Get additional product metadata
      const metadata = await this.getProductMetadata(productId);
      
      return {
        id: product.id,
        product_name: product.product_name,
        description: product.description,
        brand: product.brand,
        category: product.category,
        manufacturer_name: product.manufacturer_name,
        origin_country: product.origin_country,
        created_at: product.created_at,
        status: product.status,
        images: metadata.images || [],
        specifications: metadata.specifications || {},
        quality_certifications: metadata.quality_certifications || [],
        sustainability_score: metadata.sustainability_score,
      };

    } catch (error) {
      console.error('Failed to get enhanced product info:', error);
      return null;
    }
  }

  /**
   * Get product metadata including images and specifications
   */
  private async getProductMetadata(productId: string): Promise<{
    images?: string[];
    specifications?: Record<string, any>;
    quality_certifications?: string[];
    sustainability_score?: number;
  }> {
    try {
      // This would typically query a product_metadata table
      // For now, return mock data
      return {
        images: [
          `https://example.com/products/${productId}/image1.jpg`,
          `https://example.com/products/${productId}/image2.jpg`,
          `https://example.com/products/${productId}/image3.jpg`,
        ],
        specifications: {
          dimensions: '10cm x 15cm x 5cm',
          weight: '250g',
          materials: ['Organic Cotton', 'Natural Dyes'],
          care_instructions: 'Hand wash only, air dry',
        },
        quality_certifications: ['Fair Trade Certified', 'Organic Certified'],
        sustainability_score: 85,
      };
    } catch (error) {
      console.error('Failed to get product metadata:', error);
      return {};
    }
  }

  /**
   * Get artisan profile linked to the product
   */
  private async getArtisanProfile(productId: string): Promise<AggregatedProductData['artisan'] | undefined> {
    try {
      // This would typically join with an artisans table
      // For now, return mock data based on productId
      const mockArtisans = [
        {
          id: '1',
          name: 'Maria Santos',
          bio: 'Master craftsperson specializing in traditional textiles with over 15 years of experience',
          location: 'Lagos, Nigeria',
          specialization: 'Traditional Textiles',
          experience_years: 15,
          rating: 4.8,
          verified: true,
          avatar_url: 'https://example.com/artisans/maria-santos.jpg',
          craft_story: 'Maria learned the art of traditional weaving from her grandmother and has been preserving these ancient techniques while creating contemporary designs.',
          contact_info: {
            website: 'https://mariasantos-textiles.com',
            social_media: {
              instagram: '@mariasantos_textiles',
              facebook: 'Maria Santos Textiles',
            },
          },
          certifications: ['Master Craftsperson Certification', 'Fair Trade Producer'],
          portfolio_items: [
            {
              id: '1',
              title: 'Traditional Kente Cloth',
              image_url: 'https://example.com/portfolio/kente1.jpg',
              description: 'Hand-woven traditional kente cloth with modern patterns',
            },
            {
              id: '2',
              title: 'Contemporary Adire Design',
              image_url: 'https://example.com/portfolio/adire1.jpg',
              description: 'Modern interpretation of traditional Adire dyeing techniques',
            },
          ],
        },
        {
          id: '2',
          name: 'James Okonkwo',
          bio: 'Renowned woodcarver and sculptor creating contemporary African art',
          location: 'Abuja, Nigeria',
          specialization: 'Wood Carving & Sculpture',
          experience_years: 12,
          rating: 4.6,
          verified: true,
          craft_story: 'James combines traditional Igbo woodcarving techniques with modern artistic expression.',
        },
      ];

      // Return random artisan for demo purposes
      const randomArtisan = mockArtisans[Math.floor(Math.random() * mockArtisans.length)];
      return randomArtisan;

    } catch (error) {
      console.error('Failed to get artisan profile:', error);
      return undefined;
    }
  }

  /**
   * Get NFT details for the product
   */
  private async getNFTDetails(productId: string): Promise<AggregatedProductData['nft'] | undefined> {
    try {
      const nft = await getNftTokenByProductId(productId);
      if (!nft) {
        return undefined;
      }

      return {
        token_id: nft.token_id,
        serial_number: nft.serial_number,
        metadata_hash: nft.metadata_hash,
        minting_timestamp: nft.created_at,
        current_owner: nft.user_id,
        transaction_count: await this.getNFTTransactionCount(nft.token_id, nft.serial_number),
        last_transfer_date: await this.getLastTransferDate(nft.token_id, nft.serial_number),
      };

    } catch (error) {
      console.error('Failed to get NFT details:', error);
      return undefined;
    }
  }

  /**
   * Get verification history for the product
   */
  private async getVerificationHistory(productId: string): Promise<AggregatedProductData['verificationHistory']> {
    try {
      // This would typically query a verification_history table
      // For now, return mock data
      const mockHistory = {
        total_verifications: Math.floor(Math.random() * 500) + 50,
        last_verification: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
        authenticity_rate: Math.floor(Math.random() * 20) + 80, // 80-100%
        geographic_distribution: {
          'Nigeria': Math.floor(Math.random() * 50) + 20,
          'Ghana': Math.floor(Math.random() * 30) + 10,
          'Kenya': Math.floor(Math.random() * 20) + 5,
          'South Africa': Math.floor(Math.random() * 15) + 5,
          'United States': Math.floor(Math.random() * 10) + 2,
          'United Kingdom': Math.floor(Math.random() * 8) + 2,
        },
        verification_trend: this.generateVerificationTrend(),
        recent_verifications: this.generateRecentVerifications(),
      };

      return mockHistory;

    } catch (error) {
      console.error('Failed to get verification history:', error);
      return {
        total_verifications: 0,
        last_verification: new Date().toISOString(),
        authenticity_rate: 0,
        geographic_distribution: {},
        verification_trend: [],
        recent_verifications: [],
      };
    }
  }

  /**
   * Get supply chain data for the product
   */
  private async getSupplyChainData(productId: string): Promise<AggregatedProductData['supplyChain'] | undefined> {
    try {
      // Mock supply chain data
      return {
        stages: [
          {
            stage_name: 'Raw Material Sourcing',
            timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            location: 'Lagos, Nigeria',
            responsible_party: 'Local Cotton Cooperative',
            verification_status: 'verified',
            documentation_url: 'https://example.com/docs/cotton-sourcing.pdf',
          },
          {
            stage_name: 'Production',
            timestamp: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
            location: 'Lagos, Nigeria',
            responsible_party: 'Maria Santos Textiles',
            verification_status: 'verified',
          },
          {
            stage_name: 'Quality Control',
            timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            location: 'Lagos, Nigeria',
            responsible_party: 'Quality Assurance Team',
            verification_status: 'verified',
          },
          {
            stage_name: 'Blockchain Registration',
            timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
            location: 'Digital',
            responsible_party: 'AfriChain Platform',
            verification_status: 'verified',
          },
        ],
        origin_verification: {
          verified: true,
          documentation: [
            'Certificate of Origin',
            'Fair Trade Documentation',
            'Organic Certification',
          ],
          certificates: [
            'FT-2024-001',
            'ORG-2024-045',
            'CO-2024-123',
          ],
        },
        sustainability_metrics: {
          carbon_footprint: 2.5, // kg CO2
          fair_trade_certified: true,
          organic_certified: true,
          recycled_materials_percentage: 15,
        },
      };

    } catch (error) {
      console.error('Failed to get supply chain data:', error);
      return undefined;
    }
  }

  /**
   * Get related products
   */
  private async getRelatedProducts(productId: string): Promise<AggregatedProductData['relatedProducts'] | undefined> {
    try {
      // Mock related products
      return [
        {
          id: 'prod-456',
          name: 'Traditional Kente Scarf',
          image_url: 'https://example.com/products/kente-scarf.jpg',
          relationship: 'same_artisan',
          authenticity_score: 92,
        },
        {
          id: 'prod-789',
          name: 'Handwoven Cotton Bag',
          image_url: 'https://example.com/products/cotton-bag.jpg',
          relationship: 'same_category',
          authenticity_score: 88,
        },
        {
          id: 'prod-101',
          name: 'Organic Dyed Fabric',
          image_url: 'https://example.com/products/dyed-fabric.jpg',
          relationship: 'same_brand',
          authenticity_score: 95,
        },
      ];

    } catch (error) {
      console.error('Failed to get related products:', error);
      return undefined;
    }
  }

  /**
   * Get market insights for the product category
   */
  private async getMarketInsights(productId: string): Promise<AggregatedProductData['marketInsights'] | undefined> {
    try {
      // Mock market insights
      return {
        average_verification_score: Math.floor(Math.random() * 20) + 80,
        market_authenticity_rate: Math.floor(Math.random() * 15) + 85,
        price_range: {
          min: 25,
          max: 150,
          currency: 'USD',
        },
        demand_trend: ['increasing', 'stable', 'decreasing'][Math.floor(Math.random() * 3)] as any,
        counterfeit_risk_level: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as any,
      };

    } catch (error) {
      console.error('Failed to get market insights:', error);
      return undefined;
    }
  }

  /**
   * Log verification attempt for analytics (privacy-compliant)
   */
  async logVerificationAttempt(
    productId: string,
    result: 'authentic' | 'counterfeit' | 'suspicious',
    verificationScore: number,
    clientInfo?: {
      location?: string;
      userAgent?: string;
      ipAddress?: string;
    }
  ): Promise<void> {
    try {
      // Hash IP address for privacy
      const hashedIp = clientInfo?.ipAddress ? 
        require('crypto').createHash('sha256').update(clientInfo.ipAddress).digest('hex') : null;

      // Store anonymized verification log
      const verificationLog = {
        product_id: productId,
        verification_timestamp: new Date().toISOString(),
        result,
        verification_score: verificationScore,
        client_location: clientInfo?.location?.replace(/[0-9]/g, 'X'), // Anonymize specific locations
        user_agent_hash: clientInfo?.userAgent ? 
          require('crypto').createHash('sha256').update(clientInfo.userAgent).digest('hex') : null,
        ip_hash: hashedIp,
      };

      // This would typically be stored in a verification_logs table
      console.log('Verification logged:', verificationLog);

    } catch (error) {
      console.error('Failed to log verification attempt:', error);
      // Don't throw error as logging shouldn't break verification
    }
  }

  /**
   * Get aggregated verification statistics
   */
  async getVerificationStatistics(): Promise<{
    totalVerifications: number;
    authenticityRate: number;
    topCategories: Array<{ category: string; count: number; authenticity_rate: number }>;
    recentTrends: Array<{ date: string; authenticity_rate: number }>;
  }> {
    try {
      // This would typically aggregate from verification_logs table
      // For now, return mock data
      return {
        totalVerifications: 15420,
        authenticityRate: 87.3,
        topCategories: [
          { category: 'Textiles', count: 5420, authenticity_rate: 89.2 },
          { category: 'Crafts', count: 3210, authenticity_rate: 85.7 },
          { category: 'Jewelry', count: 2890, authenticity_rate: 91.4 },
          { category: 'Art', count: 2100, authenticity_rate: 83.6 },
          { category: 'Furniture', count: 1800, authenticity_rate: 88.9 },
        ],
        recentTrends: this.generateRecentTrends(),
      };

    } catch (error) {
      console.error('Failed to get verification statistics:', error);
      throw new Error('Statistics retrieval failed');
    }
  }

  // Helper methods

  private async getNFTTransactionCount(tokenId: string, serialNumber: number): Promise<number> {
    // Mock transaction count
    return Math.floor(Math.random() * 10) + 1;
  }

  private async getLastTransferDate(tokenId: string, serialNumber: number): Promise<string | undefined> {
    // Mock last transfer date
    const randomDays = Math.floor(Math.random() * 180);
    return new Date(Date.now() - randomDays * 24 * 60 * 60 * 1000).toISOString();
  }

  private generateVerificationTrend(): Array<{ date: string; count: number; authenticity_percentage: number }> {
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      trend.push({
        date: date.toISOString().split('T')[0],
        count: Math.floor(Math.random() * 50) + 10,
        authenticity_percentage: Math.floor(Math.random() * 20) + 80,
      });
    }
    return trend;
  }

  private generateRecentVerifications(): Array<{
    timestamp: string;
    result: 'authentic' | 'counterfeit' | 'suspicious';
    location?: string;
    verification_score: number;
  }> {
    const results = ['authentic', 'counterfeit', 'suspicious'] as const;
    const locations = ['Lagos, Nigeria', 'Accra, Ghana', 'Nairobi, Kenya', 'Cape Town, South Africa'];
    const recent = [];

    for (let i = 0; i < 10; i++) {
      recent.push({
        timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
        result: results[Math.floor(Math.random() * results.length)],
        location: locations[Math.floor(Math.random() * locations.length)],
        verification_score: Math.floor(Math.random() * 40) + 60,
      });
    }

    return recent.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  private generateRecentTrends(): Array<{ date: string; authenticity_rate: number }> {
    const trends = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      trends.push({
        date: date.toISOString().split('T')[0],
        authenticity_rate: Math.floor(Math.random() * 15) + 80,
      });
    }
    return trends;
  }
}

// Export singleton instance
export const productDataAggregationService = new ProductDataAggregationService();

export default productDataAggregationService;