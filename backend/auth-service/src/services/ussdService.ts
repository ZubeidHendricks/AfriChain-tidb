import MultiChannelSessionService, { USSDSession, AuthChannel } from './multiChannelSessionService';
import Database from '../config/database';
import { hashPhoneNumber } from '../utils/crypto';

export interface USSDRequest {
  sessionId?: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
  networkCode?: string;
}

export interface USSDResponse {
  sessionId: string;
  response: string;
  endSession: boolean;
}

export interface USSDMenuState {
  level: number;
  path: string[];
  data: Record<string, any>;
}

class USSDService {
  private multiChannelSession: MultiChannelSessionService;
  private database: Database;

  constructor() {
    this.multiChannelSession = new MultiChannelSessionService();
    this.database = Database.getInstance();
  }

  /**
   * Process USSD request and return appropriate response
   */
  async processUSSDRequest(request: USSDRequest): Promise<USSDResponse> {
    try {
      console.log(`USSD Request: ${request.phoneNumber} - ${request.text}`);

      // Check if user exists in our system
      const user = await this.getUserByPhoneNumber(request.phoneNumber);
      
      if (!user) {
        // User not registered - show registration message
        return {
          sessionId: request.sessionId || '',
          response: 'END Welcome to AfriChain Authenticity!\nYou need to register first via our web platform or mobile app.\nVisit: app.africhain.co',
          endSession: true
        };
      }

      // Parse USSD input
      const menuPath = request.text ? request.text.split('*') : [];
      
      // Get or create USSD session
      let ussdSession = await this.getOrCreateUSSDSession(
        user.id,
        request.phoneNumber,
        request.sessionId,
        request.networkCode
      );

      // Process menu navigation
      const menuResult = await this.processMenuNavigation(ussdSession, menuPath, user);
      
      // Update session state
      if (!menuResult.endSession && request.sessionId) {
        await this.multiChannelSession.updateUSSDState(
          request.sessionId,
          menuResult.menuState || 'main',
          { lastAction: menuPath[menuPath.length - 1] || 'start' }
        );
      }

      return {
        sessionId: ussdSession.sessionId,
        response: menuResult.response,
        endSession: menuResult.endSession
      };

    } catch (error) {
      console.error('Error processing USSD request:', error);
      return {
        sessionId: request.sessionId || '',
        response: 'END Service temporarily unavailable. Please try again later.',
        endSession: true
      };
    }
  }

  /**
   * Get or create USSD session for user
   */
  private async getOrCreateUSSDSession(
    userId: string,
    phoneNumber: string,
    ussdSessionId?: string,
    networkCode?: string
  ): Promise<USSDSession> {
    // Try to get existing session if sessionId provided
    if (ussdSessionId) {
      const existingState = await this.multiChannelSession.getUSSDState(ussdSessionId);
      if (existingState && existingState.userId === userId) {
        const existingSession = await this.multiChannelSession.getChannelSession(existingState.sessionId) as USSDSession;
        if (existingSession) {
          return existingSession;
        }
      }
    }

    // Create new USSD session
    const session = await this.multiChannelSession.createChannelSession(
      userId,
      phoneNumber,
      'ussd',
      {
        ussdSessionId,
        deviceInfo: {
          platform: networkCode || 'ussd',
          userAgent: `USSD-${networkCode}`,
          ipAddress: 'ussd-gateway'
        },
        metadata: {
          networkCode,
          menuState: 'main'
        }
      }
    ) as USSDSession;

    return session;
  }

  /**
   * Process USSD menu navigation
   */
  private async processMenuNavigation(
    session: USSDSession,
    menuPath: string[],
    user: any
  ): Promise<{ response: string; endSession: boolean; menuState?: string }> {
    
    // If no input, show main menu
    if (menuPath.length === 0 || menuPath[0] === '') {
      return {
        response: await this.getMainMenu(user),
        endSession: false,
        menuState: 'main'
      };
    }

    const choice = menuPath[menuPath.length - 1];

    // Handle main menu choices
    switch (menuPath[0]) {
      case '1':
        return await this.handleProductMenu(menuPath, user);
      
      case '2':
        return await this.handleVerificationMenu(menuPath, user);
      
      case '3':
        return await this.handleAccountMenu(menuPath, user);
      
      case '4':
        return await this.handleHelpMenu();
      
      case '0':
        return {
          response: 'END Thank you for using AfriChain Authenticity!',
          endSession: true
        };
      
      default:
        return {
          response: 'CON Invalid option. Please try again:\n' + await this.getMainMenu(user),
          endSession: false,
          menuState: 'main'
        };
    }
  }

  /**
   * Get main USSD menu
   */
  private async getMainMenu(user: any): Promise<string> {
    const userName = user.phoneNumber.substr(-4); // Last 4 digits for privacy
    
    return `CON Welcome to AfriChain, *${userName}
1. My Products
2. Verify Product
3. Account Info
4. Help
0. Exit`;
  }

  /**
   * Handle product management menu
   */
  private async handleProductMenu(
    menuPath: string[],
    user: any
  ): Promise<{ response: string; endSession: boolean; menuState?: string }> {
    
    if (menuPath.length === 1) {
      // Show product submenu
      const productCount = await this.getUserProductCount(user.id);
      
      return {
        response: `CON My Products (${productCount})
1. View Products
2. Quick Register
3. Product Status
0. Back to Main Menu`,
        endSession: false,
        menuState: 'products'
      };
    }

    const subChoice = menuPath[1];
    
    switch (subChoice) {
      case '1':
        return await this.showUserProducts(user.id);
      
      case '2':
        return await this.quickProductRegistration(user.id);
      
      case '3':
        return await this.showProductStatus(user.id);
      
      case '0':
        return {
          response: await this.getMainMenu(user),
          endSession: false,
          menuState: 'main'
        };
      
      default:
        return {
          response: `CON Invalid option. 
1. View Products
2. Quick Register
3. Product Status
0. Back`,
          endSession: false,
          menuState: 'products'
        };
    }
  }

  /**
   * Handle product verification menu
   */
  private async handleVerificationMenu(
    menuPath: string[],
    user: any
  ): Promise<{ response: string; endSession: boolean; menuState?: string }> {
    
    if (menuPath.length === 1) {
      return {
        response: `CON Verify Product
Enter product code (6 digits):`,
        endSession: false,
        menuState: 'verify_input'
      };
    }

    const productCode = menuPath[1];
    
    if (!/^\d{6}$/.test(productCode)) {
      return {
        response: `CON Invalid code format.
Enter 6-digit product code:`,
        endSession: false,
        menuState: 'verify_input'
      };
    }

    // Verify product code
    const verificationResult = await this.verifyProductCode(productCode);
    
    if (verificationResult.valid) {
      return {
        response: `END ✓ AUTHENTIC PRODUCT
Product: ${verificationResult.productName}
Artisan: ${verificationResult.artisanName}
Location: ${verificationResult.location}
Certified: ${verificationResult.certifiedDate}`,
        endSession: true
      };
    } else {
      return {
        response: `END ⚠ WARNING: Product Not Found
Code: ${productCode}
This product is not in our database.
Report fraud: 0700123456`,
        endSession: true
      };
    }
  }

  /**
   * Handle account information menu
   */
  private async handleAccountMenu(
    menuPath: string[],
    user: any
  ): Promise<{ response: string; endSession: boolean; menuState?: string }> {
    
    const userStats = await this.getUserStats(user.id);
    
    return {
      response: `END Account Information
Phone: ${user.phoneNumber}
Products: ${userStats.productCount}
Verified: ${userStats.verifiedCount}
Member since: ${userStats.memberSince}
Status: Active`,
      endSession: true
    };
  }

  /**
   * Handle help menu
   */
  private async handleHelpMenu(): Promise<{ response: string; endSession: boolean; menuState?: string }> {
    return {
      response: `END AfriChain Authenticity Help

• Product codes are 6 digits
• Report fraud: 0700123456
• Web app: app.africhain.co
• Support: support@africhain.co

Thank you for fighting counterfeits!`,
      endSession: true
    };
  }

  /**
   * Show user's products
   */
  private async showUserProducts(userId: string): Promise<{ response: string; endSession: boolean }> {
    try {
      // This would fetch from products table in real implementation
      const products = await this.getUserRecentProducts(userId, 5);
      
      if (products.length === 0) {
        return {
          response: 'END No products found.\nRegister your first product on our web platform: app.africhain.co',
          endSession: true
        };
      }

      let response = 'END Recent Products:\n';
      products.forEach((product, index) => {
        response += `${index + 1}. ${product.name}\n   Code: ${product.code}\n   Status: ${product.status}\n`;
      });

      return {
        response,
        endSession: true
      };

    } catch (error) {
      console.error('Error showing user products:', error);
      return {
        response: 'END Error retrieving products.\nPlease try again later.',
        endSession: true
      };
    }
  }

  /**
   * Quick product registration
   */
  private async quickProductRegistration(userId: string): Promise<{ response: string; endSession: boolean }> {
    return {
      response: `END Quick Product Registration
Not available via USSD.

Please use:
• Web app: app.africhain.co  
• Mobile app from Play Store

Full registration requires:
• Product photos
• Detailed description
• Category selection`,
      endSession: true
    };
  }

  /**
   * Show product status
   */
  private async showProductStatus(userId: string): Promise<{ response: string; endSession: boolean }> {
    try {
      const stats = await this.getUserProductStats(userId);
      
      return {
        response: `END Product Status Summary
Total: ${stats.total}
Pending: ${stats.pending}
Active: ${stats.active}
Verified: ${stats.verified}
Issues: ${stats.issues}

Check web app for details.`,
        endSession: true
      };

    } catch (error) {
      console.error('Error getting product status:', error);
      return {
        response: 'END Error retrieving status.\nPlease try again later.',
        endSession: true
      };
    }
  }

  // Helper methods for database operations

  /**
   * Get user by phone number
   */
  private async getUserByPhoneNumber(phoneNumber: string): Promise<any> {
    try {
      const db = this.database;
      const connection = await db.getConnection();
      const phoneHash = hashPhoneNumber(phoneNumber);

      const [users] = await connection.execute(
        'SELECT id, phone_number_hash, created_at FROM users WHERE phone_number_hash = ?',
        [phoneHash]
      );

      const userList = users as any[];
      if (userList.length > 0) {
        return {
          id: userList[0].id,
          phoneNumber: phoneNumber,
          createdAt: userList[0].created_at
        };
      }

      return null;

    } catch (error) {
      console.error('Error getting user by phone number:', error);
      return null;
    }
  }

  /**
   * Get user product count
   */
  private async getUserProductCount(userId: string): Promise<number> {
    // Mock implementation - replace with actual database query
    return Math.floor(Math.random() * 10) + 1;
  }

  /**
   * Get user recent products
   */
  private async getUserRecentProducts(userId: string, limit: number): Promise<any[]> {
    // Mock implementation - replace with actual database query
    return [
      { name: 'Maasai Beadwork', code: '123456', status: 'Active' },
      { name: 'Kikuyu Basket', code: '789012', status: 'Verified' },
      { name: 'Turkana Jewelry', code: '345678', status: 'Pending' }
    ].slice(0, limit);
  }

  /**
   * Verify product code
   */
  private async verifyProductCode(code: string): Promise<{
    valid: boolean;
    productName?: string;
    artisanName?: string;
    location?: string;
    certifiedDate?: string;
  }> {
    // Mock implementation - replace with actual blockchain verification
    const mockProducts = {
      '123456': {
        valid: true,
        productName: 'Authentic Maasai Beadwork',
        artisanName: 'Mary Nasirian',
        location: 'Kajiado, Kenya',
        certifiedDate: '2025-01-15'
      },
      '789012': {
        valid: true,
        productName: 'Traditional Kikuyu Basket',
        artisanName: 'Peter Mwangi',
        location: 'Nyeri, Kenya',
        certifiedDate: '2025-01-10'
      }
    };

    return mockProducts[code as keyof typeof mockProducts] || { valid: false };
  }

  /**
   * Get user statistics
   */
  private async getUserStats(userId: string): Promise<{
    productCount: number;
    verifiedCount: number;
    memberSince: string;
  }> {
    // Mock implementation - replace with actual database queries
    return {
      productCount: 5,
      verifiedCount: 3,
      memberSince: 'Jan 2025'
    };
  }

  /**
   * Get user product statistics
   */
  private async getUserProductStats(userId: string): Promise<{
    total: number;
    pending: number;
    active: number;
    verified: number;
    issues: number;
  }> {
    // Mock implementation - replace with actual database queries
    return {
      total: 5,
      pending: 1,
      active: 2,
      verified: 2,
      issues: 0
    };
  }
}

export default USSDService;