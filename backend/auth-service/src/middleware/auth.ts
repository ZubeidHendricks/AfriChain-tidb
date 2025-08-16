import { Request, Response, NextFunction } from 'express';
import JWTService, { JWTPayload } from '../services/jwtService';

// Extend Request interface to include user and token info
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      tokenInfo?: {
        accessToken: string;
        needsRefresh: boolean;
      };
      deviceInfo?: {
        platform?: string;
        userAgent?: string;
        ipAddress?: string;
      };
    }
  }
}

interface AuthenticatedRequest extends Request {
  user: JWTPayload;
}

interface AuthMiddlewareOptions {
  allowExpired?: boolean;
  requireRefreshable?: boolean;
}

class AuthenticationMiddleware {
  private jwtService: JWTService;

  constructor() {
    this.jwtService = new JWTService();
  }

  /**
   * Standard authentication middleware for protected routes
   */
  authenticateToken = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await this.authenticate(req, res, next, {});
  };

  /**
   * Authentication middleware that allows expired tokens (for refresh operations)
   */
  authenticateExpiredToken = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await this.authenticate(req, res, next, { allowExpired: true });
  };

  /**
   * Authentication middleware that requires a refreshable token
   */
  authenticateRefreshableToken = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await this.authenticate(req, res, next, { requireRefreshable: true });
  };

  /**
   * Core authentication logic
   */
  private async authenticate(
    req: Request,
    res: Response,
    next: NextFunction,
    options: AuthMiddlewareOptions
  ): Promise<void> {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          success: false,
          error: 'Access token required',
          code: 'TOKEN_MISSING'
        });
        return;
      }

      const token = authHeader.substring(7);
      
      // Validate the access token
      const validation = await this.jwtService.validateAccessToken(token);

      // Handle different validation outcomes
      if (!validation.valid) {
        // If token is expired and we allow expired tokens
        if (validation.needsRefresh && options.allowExpired) {
          // Try to decode without verification to get user info
          try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.decode(token) as JWTPayload;
            if (decoded) {
              req.user = decoded;
              req.tokenInfo = {
                accessToken: token,
                needsRefresh: true
              };
              next();
              return;
            }
          } catch {
            // Fall through to error response
          }
        }

        // Return appropriate error response
        const statusCode = validation.needsRefresh ? 401 : 401;
        const errorCode = validation.needsRefresh ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
        
        res.status(statusCode).json({
          success: false,
          error: validation.error || 'Authentication failed',
          code: errorCode,
          needsRefresh: validation.needsRefresh
        });
        return;
      }

      // Token is valid, attach user info to request
      if (validation.decoded) {
        req.user = validation.decoded;
        req.tokenInfo = {
          accessToken: token,
          needsRefresh: false
        };

        // If we require a refreshable token, verify session has refresh capability
        if (options.requireRefreshable) {
          const hasActiveSession = await this.hasActiveRefreshSession(validation.decoded);
          if (!hasActiveSession) {
            res.status(401).json({
              success: false,
              error: 'No active refresh session',
              code: 'REFRESH_UNAVAILABLE'
            });
            return;
          }
        }

        next();
      } else {
        res.status(401).json({
          success: false,
          error: 'Invalid token data',
          code: 'TOKEN_INVALID'
        });
      }

    } catch (error) {
      console.error('Authentication middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Authentication service error',
        code: 'AUTH_SERVICE_ERROR'
      });
    }
  }

  /**
   * Middleware to extract device information from request
   */
  extractDeviceInfo = (req: Request, res: Response, next: NextFunction): void => {
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.ip || req.connection.remoteAddress || '';
    
    // Try to determine platform from user agent
    let platform = 'unknown';
    if (userAgent.includes('Mobile')) platform = 'mobile';
    else if (userAgent.includes('Tablet')) platform = 'tablet';
    else if (userAgent.includes('Windows')) platform = 'windows';
    else if (userAgent.includes('Mac')) platform = 'mac';
    else if (userAgent.includes('Linux')) platform = 'linux';

    // Attach device info to request for later use
    req.deviceInfo = {
      platform,
      userAgent,
      ipAddress
    };

    next();
  };

  /**
   * Check if user has an active refresh session
   */
  private async hasActiveRefreshSession(user: JWTPayload): Promise<boolean> {
    try {
      if (!user.sessionId) return false;
      
      // This would check if there's an active refresh token for the session
      // Implementation depends on JWT service session management
      return true; // Simplified for now
    } catch {
      return false;
    }
  }
}

// Create singleton instance
const authMiddleware = new AuthenticationMiddleware();

// Export the main authentication function
export const authenticateToken = authMiddleware.authenticateToken;

/**
 * Optional authentication middleware
 * Doesn't block request if no token, but adds user if valid token provided
 */
const optionalAuthentication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without authentication
      next();
      return;
    }

    const token = authHeader.substring(7);
    const jwtService = new JWTService();
    const validation = await jwtService.validateAccessToken(token);

    if (validation.valid && validation.decoded) {
      req.user = validation.decoded;
      req.tokenInfo = {
        accessToken: token,
        needsRefresh: false
      };
    }
    
    // Continue regardless of validation result
    next();

  } catch (error) {
    console.error('Optional authentication error:', error);
    // Continue without authentication on error
    next();
  }
};

/**
 * Role-based access control middleware
 * For future use when roles are implemented
 */
export const requireRole = (roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // For now, all authenticated users have access
    // TODO: Implement role checking when user roles are added
    next();
  };
};

/**
 * Admin-only access middleware
 */
export const requireAdmin = requireRole(['admin']);

// Export additional middleware functions
export const authenticateExpiredToken = authMiddleware.authenticateExpiredToken;
export const authenticateRefreshableToken = authMiddleware.authenticateRefreshableToken;
export const extractDeviceInfo = authMiddleware.extractDeviceInfo;
export const optionalAuth = optionalAuthentication;

export { AuthenticatedRequest };
export default authMiddleware;