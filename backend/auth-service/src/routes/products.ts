import express, { Request, Response } from 'express';
import ProductService, { ProductRegistrationRequest } from '../services/productService';
import { 
  uploadProductData, 
  uploadMultipleProductImages, 
  uploadSingleProductImage,
  handleUploadError,
  requireProductImages,
  validateProductData,
  MulterRequest 
} from '../middleware/upload';
import { authenticateToken } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import Joi from 'joi';

const router = express.Router();
const productService = new ProductService();

// Validation schemas
const productRegistrationSchema = Joi.object({
  productName: Joi.string().min(2).max(100).required(),
  description: Joi.string().min(10).max(2000).required(),
  category: Joi.string().min(2).max(50).required(),
  brand: Joi.string().max(50).optional(),
  model: Joi.string().max(50).optional(),
  serialNumber: Joi.string().max(100).optional(),
  batchNumber: Joi.string().max(50).optional(),
  manufacturerName: Joi.string().max(100).optional(),
  manufacturerAddress: Joi.string().max(200).optional(),
  originCountry: Joi.string().max(50).optional(),
  tags: Joi.string().max(500).optional(),
  additionalMetadata: Joi.object().optional()
});

const productUpdateSchema = Joi.object({
  productName: Joi.string().min(2).max(100).optional(),
  description: Joi.string().min(10).max(2000).optional(),
  category: Joi.string().min(2).max(50).optional(),
  brand: Joi.string().max(50).optional(),
  model: Joi.string().max(50).optional(),
  serialNumber: Joi.string().max(100).optional(),
  batchNumber: Joi.string().max(50).optional(),
  manufacturerName: Joi.string().max(100).optional(),
  manufacturerAddress: Joi.string().max(200).optional(),
  originCountry: Joi.string().max(50).optional(),
  tags: Joi.string().max(500).optional(),
  additionalMetadata: Joi.object().optional()
});

// Route handlers using database-backed ProductService

/**
 * POST /products/register
 * Register a new product with images
 */
router.post('/register',
  authenticateToken,
  uploadProductData,
  handleUploadError,
  requireProductImages,
  validateProductData,
  validateRequest(productRegistrationSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const multerReq = req as MulterRequest;
      const userId = (req as any).user.userId;
      
      // Extract uploaded files
      const files = multerReq.files as { [fieldname: string]: Express.Multer.File[] };
      const imageGroups = {
        primary: files.primaryImage || [],
        additional: files.additionalImages || [],
        certificates: files.certificateImages || []
      };
      
      const productData: ProductRegistrationRequest = req.body;
      
      // Register product using the service
      const result = await productService.registerProduct(userId, productData, imageGroups);
      
      res.status(201).json({
        success: true,
        message: 'Product registered successfully',
        data: result
      });
      
    } catch (error) {
      console.error('❌ Product registration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Product registration failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * GET /products/catalog
 * Public product catalog with search and filtering
 */
router.get('/catalog',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const query = req.query.q as string;
      const category = req.query.category as string;
      const location = req.query.location as string;
      
      // Search products using the service
      const result = await productService.searchProducts({
        query,
        page,
        limit,
        status: 'active', // Only show active products in public catalog
        category,
        location
      });
      
      // Transform products for catalog view
      const catalogProducts = [];
      for (const product of result.products) {
        const completeData = await productService.getCompleteProductData(product.id);
        if (completeData) {
          const primaryImage = completeData.images.find(img => img.imageType === 'primary');
          
          catalogProducts.push({
            id: product.id,
            productName: product.productName,
            description: product.description.length > 150 ? 
              product.description.substring(0, 150) + '...' : product.description,
            category: product.category,
            brand: product.brand,
            manufacturerName: product.manufacturerName,
            originCountry: product.originCountry,
            primaryImage: primaryImage ? {
              url: `${process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs'}/${primaryImage.originalCid}`,
              thumbnailUrl: `${process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs'}/${primaryImage.thumbnailMediumCid}`
            } : null,
            totalImages: completeData.metadata?.totalImages || 0,
            createdAt: product.createdAt
          });
        }
      }
      
      res.json({
        success: true,
        data: {
          products: catalogProducts,
          pagination: {
            page: result.page,
            limit,
            total: result.total,
            totalPages: result.totalPages,
            hasNext: page < result.totalPages,
            hasPrev: page > 1
          },
          filters: {
            query,
            category,
            location,
            applied: {
              hasQuery: !!query,
              hasCategory: !!category,
              hasLocation: !!location
            }
          }
        }
      });
      
    } catch (error) {
      console.error('Error searching product catalog:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search product catalog'
      });
    }
  }
);

/**
 * GET /products/catalog/filters
 * Get available filter options for catalog
 */
router.get('/catalog/filters',
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get distinct categories and locations from active products
      const filterOptions = await productService.getCatalogFilters();
      
      res.json({
        success: true,
        data: {
          categories: ['woodwork', 'textiles', 'pottery', 'jewelry', 'metalwork'],
          locations: filterOptions.locations,
          availableFilters: {
            categories: filterOptions.categories,
            countries: filterOptions.countries,
            totalProducts: filterOptions.totalProducts
          }
        }
      });
      
    } catch (error) {
      console.error('Error retrieving catalog filters:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve catalog filters'
      });
    }
  }
);

/**
 * GET /products/:productId
 * Get product details by ID
 */
router.get('/:productId',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { productId } = req.params;
      const userId = (req as any).user.userId;
      
      const completeData = await productService.getCompleteProductData(productId, userId);
      if (!completeData) {
        res.status(404).json({
          success: false,
          error: 'Product not found'
        });
        return;
      }
      
      const transformedProduct = productService.transformProductToResponse(completeData);
      
      res.json({
        success: true,
        data: transformedProduct
      });
      
    } catch (error) {
      console.error('Error retrieving product:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve product'
      });
    }
  }
);

/**
 * GET /products
 * Get user's products with pagination
 */
router.get('/',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;
      const category = req.query.category as string;
      
      // Get user products using service
      const result = await productService.getUserProducts(userId, {
        page,
        limit,
        status,
        category
      });
      
      // Transform products for list view
      const productSummaries = [];
      for (const product of result.products) {
        const completeData = await productService.getCompleteProductData(product.id, userId);
        if (completeData) {
          const primaryImage = completeData.images.find(img => img.imageType === 'primary');
          
          productSummaries.push({
            id: product.id,
            productName: product.productName,
            description: product.description.length > 100 ? 
              product.description.substring(0, 100) + '...' : product.description,
            category: product.category,
            status: product.status,
            primaryImage: primaryImage ? {
              url: `${process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs'}/${primaryImage.originalCid}`,
              thumbnailUrl: `${process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs'}/${primaryImage.thumbnailSmallCid}`
            } : null,
            totalImages: completeData.metadata?.totalImages || 0,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt
          });
        }
      }
      
      res.json({
        success: true,
        data: {
          products: productSummaries,
          pagination: {
            page: result.page,
            limit,
            total: result.total,
            totalPages: result.totalPages,
            hasNext: page < result.totalPages,
            hasPrev: page > 1
          },
          filters: {
            status,
            category
          }
        }
      });
      
    } catch (error) {
      console.error('Error retrieving products:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve products'
      });
    }
  }
);

/**
 * PUT /products/:productId
 * Update product information (excluding images)
 */
router.put('/:productId',
  authenticateToken,
  validateRequest(productUpdateSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { productId } = req.params;
      const userId = (req as any).user.userId;
      const updateData = req.body;
      
      // Update product using service
      const success = await productService.updateProduct(productId, userId, updateData);
      
      if (!success) {
        res.status(404).json({
          success: false,
          error: 'Product not found or access denied'
        });
        return;
      }
      
      // Get updated product data
      const completeData = await productService.getCompleteProductData(productId, userId);
      if (!completeData) {
        res.status(404).json({
          success: false,
          error: 'Product not found after update'
        });
        return;
      }
      
      const transformedProduct = productService.transformProductToResponse(completeData);
      
      console.log(`✅ Product updated: ${productId}`);
      
      res.json({
        success: true,
        message: 'Product updated successfully',
        data: transformedProduct
      });
      
    } catch (error) {
      console.error('Error updating product:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update product'
      });
    }
  }
);

/**
 * POST /products/:productId/images
 * Add additional images to existing product
 */
router.post('/:productId/images',
  authenticateToken,
  uploadMultipleProductImages,
  handleUploadError,
  requireProductImages,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { productId } = req.params;
      const userId = (req as any).user.userId;
      const multerReq = req as MulterRequest;
      
      const files = multerReq.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No images provided'
        });
        return;
      }
      
      // Add images using service
      const result = await productService.addProductImages(productId, userId, files);
      
      console.log(`✅ Added ${result.newImages} images to product: ${productId}`);
      
      res.json({
        success: true,
        message: 'Images added successfully',
        data: {
          productId,
          newImages: result.newImages,
          totalImages: result.totalImages,
          additionalStorageSize: result.additionalStorageSize,
          totalStorageSize: result.totalStorageSize
        }
      });
      
    } catch (error) {
      console.error('Error adding images to product:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add images to product'
      });
    }
  }
);

/**
 * DELETE /products/:productId
 * Delete product and all associated images
 */
router.delete('/:productId',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { productId } = req.params;
      const userId = (req as any).user.userId;
      
      // Delete product using service
      const result = await productService.deleteProduct(productId, userId);
      
      if (!result.success) {
        res.status(404).json({
          success: false,
          error: 'Product not found or access denied'
        });
        return;
      }
      
      console.log(`🗑️ Product deleted: ${productId} (${result.deletedImages}/${result.totalImages} images removed from IPFS)`);
      
      res.json({
        success: true,
        message: 'Product deleted successfully',
        data: {
          productId,
          deletedImages: result.deletedImages,
          totalImages: result.totalImages
        }
      });
      
    } catch (error) {
      console.error('Error deleting product:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete product'
      });
    }
  }
);

/**
 * GET /products/:productId/images/:cid
 * Get specific image by CID (proxy to IPFS)
 */
router.get('/:productId/images/:cid',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { productId, cid } = req.params;
      const userId = (req as any).user.userId;
      
      // Verify user owns the product
      const userOwns = await productService.userOwnsProduct(productId, userId);
      if (!userOwns) {
        res.status(404).json({
          success: false,
          error: 'Product not found or access denied'
        });
        return;
      }
      
      // Get product metadata to verify CID belongs to this product
      const completeData = await productService.getCompleteProductData(productId, userId);
      if (!completeData || !completeData.metadata) {
        res.status(404).json({
          success: false,
          error: 'Product metadata not found'
        });
        return;
      }
      
      const ipfsHashes = JSON.parse(completeData.metadata.ipfsHashes) as string[];
      if (!ipfsHashes.includes(cid)) {
        res.status(404).json({
          success: false,
          error: 'Image not found in this product'
        });
        return;
      }
      
      // For image retrieval, we'll redirect to the IPFS gateway
      // This is more efficient than proxying the entire image through our service
      const gatewayUrl = `${process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs'}/${cid}`;
      res.redirect(302, gatewayUrl);
      
    } catch (error) {
      console.error('Error retrieving image:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve image'
      });
    }
  }
);

/**
 * GET /products/health
 * Health check for product registration service
 */
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const healthStatus = await productService.getHealthStatus();
    
    res.json({
      success: true,
      status: healthStatus.status,
      timestamp: new Date().toISOString(),
      services: healthStatus.services
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;