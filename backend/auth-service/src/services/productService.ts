import { v4 as uuidv4 } from 'uuid';
import ProductModel, { ProductData, ProductImageData, ProductMetadata } from '../models/Product';
import ImageUploadService, { ProcessedImage } from './imageUploadService';

export interface ProductRegistrationRequest {
  productName: string;
  description: string;
  category: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  batchNumber?: string;
  manufacturerName?: string;
  manufacturerAddress?: string;
  originCountry?: string;
  tags?: string;
  additionalMetadata?: Record<string, any>;
}

export interface ProductImageGroup {
  primary?: Express.Multer.File[];
  additional?: Express.Multer.File[];
  certificates?: Express.Multer.File[];
}

export interface ProductRegistrationResult {
  productId: string;
  productName: string;
  status: string;
  images: {
    totalImages: number;
    primaryImage: { cid: string; url: string } | null;
    additionalImages: number;
    certificateImages: number;
  };
  metadata: {
    totalStorageSize: number;
    ipfsHashes: number;
    registrationId: string;
  };
  createdAt: Date;
}

export interface CompleteProductData {
  product: ProductData;
  images: ProductImageData[];
  metadata: ProductMetadata | null;
}

class ProductService {
  private productModel: ProductModel;
  private imageUploadService: ImageUploadService;

  constructor() {
    this.productModel = new ProductModel();
    this.imageUploadService = new ImageUploadService();
  }

  /**
   * Register a new product with images
   */
  async registerProduct(
    userId: string,
    productData: ProductRegistrationRequest,
    imageGroups: ProductImageGroup
  ): Promise<ProductRegistrationResult> {
    const productId = uuidv4();
    
    console.log(`🚀 Starting product registration for user: ${userId}`);
    console.log(`📝 Product: ${productData.productName}`);

    // Extract files from groups
    const primaryFiles = imageGroups.primary || [];
    const additionalFiles = imageGroups.additional || [];
    const certificateFiles = imageGroups.certificates || [];
    
    const totalFiles = primaryFiles.length + additionalFiles.length + certificateFiles.length;
    if (totalFiles === 0) {
      throw new Error('At least one image is required for product registration');
    }

    console.log(`📸 Processing ${totalFiles} images`);

    // Create product record first
    const productRecord: Omit<ProductData, 'createdAt' | 'updatedAt'> = {
      id: productId,
      userId,
      productName: productData.productName,
      description: productData.description,
      category: productData.category,
      brand: productData.brand,
      model: productData.model,
      serialNumber: productData.serialNumber,
      batchNumber: productData.batchNumber,
      manufacturerName: productData.manufacturerName,
      manufacturerAddress: productData.manufacturerAddress,
      originCountry: productData.originCountry,
      tags: productData.tags,
      additionalMetadata: productData.additionalMetadata ? JSON.stringify(productData.additionalMetadata) : undefined,
      status: 'pending'
    };

    const productCreated = await this.productModel.createProduct(productRecord);
    if (!productCreated) {
      throw new Error('Failed to create product record');
    }

    // Process and upload images
    const imageRecords: Omit<ProductImageData, 'createdAt'>[] = [];
    let totalStorageSize = 0;
    const allIpfsHashes: string[] = [];
    const allChecksums: Record<string, string> = {};

    // Process primary images
    if (primaryFiles.length > 0) {
      for (const file of primaryFiles) {
        const processedImage = await this.imageUploadService.uploadImageToIPFS(
          file.buffer,
          file.originalname,
          file.mimetype,
          true,
          true
        );

        const imageRecord: Omit<ProductImageData, 'createdAt'> = {
          id: uuidv4(),
          productId,
          imageType: 'primary',
          originalCid: processedImage.originalImage.cid,
          optimizedCid: processedImage.optimizedImage.cid,
          thumbnailSmallCid: processedImage.thumbnails.small.cid,
          thumbnailMediumCid: processedImage.thumbnails.medium.cid,
          thumbnailLargeCid: processedImage.thumbnails.large.cid,
          originalName: file.originalname,
          size: processedImage.originalImage.size,
          checksum: processedImage.checksums.original
        };

        imageRecords.push(imageRecord);
        totalStorageSize += processedImage.originalImage.size;
        allIpfsHashes.push(processedImage.originalImage.cid);
        allChecksums[processedImage.originalImage.cid] = processedImage.checksums.original;
      }
    }

    // Process additional images
    if (additionalFiles.length > 0) {
      for (const file of additionalFiles) {
        const processedImage = await this.imageUploadService.uploadImageToIPFS(
          file.buffer,
          file.originalname,
          file.mimetype,
          true,
          true
        );

        const imageRecord: Omit<ProductImageData, 'createdAt'> = {
          id: uuidv4(),
          productId,
          imageType: 'additional',
          originalCid: processedImage.originalImage.cid,
          optimizedCid: processedImage.optimizedImage.cid,
          thumbnailSmallCid: processedImage.thumbnails.small.cid,
          thumbnailMediumCid: processedImage.thumbnails.medium.cid,
          thumbnailLargeCid: processedImage.thumbnails.large.cid,
          originalName: file.originalname,
          size: processedImage.originalImage.size,
          checksum: processedImage.checksums.original
        };

        imageRecords.push(imageRecord);
        totalStorageSize += processedImage.originalImage.size;
        allIpfsHashes.push(processedImage.originalImage.cid);
        allChecksums[processedImage.originalImage.cid] = processedImage.checksums.original;
      }
    }

    // Process certificate images
    if (certificateFiles.length > 0) {
      for (const file of certificateFiles) {
        const processedImage = await this.imageUploadService.uploadImageToIPFS(
          file.buffer,
          file.originalname,
          file.mimetype,
          true,
          true
        );

        const imageRecord: Omit<ProductImageData, 'createdAt'> = {
          id: uuidv4(),
          productId,
          imageType: 'certificate',
          originalCid: processedImage.originalImage.cid,
          optimizedCid: processedImage.optimizedImage.cid,
          thumbnailSmallCid: processedImage.thumbnails.small.cid,
          thumbnailMediumCid: processedImage.thumbnails.medium.cid,
          thumbnailLargeCid: processedImage.thumbnails.large.cid,
          originalName: file.originalname,
          size: processedImage.originalImage.size,
          checksum: processedImage.checksums.original
        };

        imageRecords.push(imageRecord);
        totalStorageSize += processedImage.originalImage.size;
        allIpfsHashes.push(processedImage.originalImage.cid);
        allChecksums[processedImage.originalImage.cid] = processedImage.checksums.original;
      }
    }

    // Save all image records
    const imagesCreated = await this.productModel.addProductImages(imageRecords);
    if (!imagesCreated) {
      throw new Error('Failed to save product images');
    }

    // Create metadata record
    const metadataRecord: Omit<ProductMetadata, 'id' | 'createdAt' | 'updatedAt'> = {
      productId,
      totalImages: totalFiles,
      totalStorageSize,
      ipfsHashes: JSON.stringify(allIpfsHashes),
      checksums: JSON.stringify(allChecksums),
      lastImageUpload: new Date()
    };

    const metadataCreated = await this.productModel.upsertProductMetadata(metadataRecord);
    if (!metadataCreated) {
      console.warn('Failed to create product metadata, but continuing...');
    }

    // Get primary image for response
    const primaryImageRecord = imageRecords.find(img => img.imageType === 'primary');
    const primaryImage = primaryImageRecord ? {
      cid: primaryImageRecord.originalCid,
      url: this.imageUploadService.getImageUrl(primaryImageRecord.originalCid)
    } : null;

    console.log(`✅ Product registration completed: ${productId}`);
    console.log(`📊 Total storage used: ${(totalStorageSize / (1024 * 1024)).toFixed(2)} MB`);

    return {
      productId,
      productName: productData.productName,
      status: 'pending',
      images: {
        totalImages: totalFiles,
        primaryImage,
        additionalImages: additionalFiles.length,
        certificateImages: certificateFiles.length
      },
      metadata: {
        totalStorageSize,
        ipfsHashes: allIpfsHashes.length,
        registrationId: productId
      },
      createdAt: new Date()
    };
  }

  /**
   * Get complete product data with images and metadata
   */
  async getCompleteProductData(productId: string, userId?: string): Promise<CompleteProductData | null> {
    const product = await this.productModel.getProductById(productId, userId);
    if (!product) {
      return null;
    }

    const [images, metadata] = await Promise.all([
      this.productModel.getProductImages(productId),
      this.productModel.getProductMetadata(productId)
    ]);

    return {
      product,
      images,
      metadata
    };
  }

  /**
   * Get paginated products for a user
   */
  async getUserProducts(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: string;
      category?: string;
    } = {}
  ) {
    return await this.productModel.getUserProducts(userId, options);
  }

  /**
   * Search products with full-text search and filters
   */
  async searchProducts(
    options: {
      query?: string;
      page?: number;
      limit?: number;
      status?: string;
      category?: string;
      location?: string;
      userId?: string;
    } = {}
  ) {
    return await this.productModel.searchProducts(options);
  }

  /**
   * Transform complete product data to API response format
   */
  transformProductToResponse(completeData: CompleteProductData) {
    const { product, images, metadata } = completeData;

    // Group images by type
    const primaryImages = images.filter(img => img.imageType === 'primary');
    const additionalImages = images.filter(img => img.imageType === 'additional');
    const certificateImages = images.filter(img => img.imageType === 'certificate');

    // Transform images to response format
    const transformImage = (img: ProductImageData) => ({
      cid: img.originalCid,
      url: this.imageUploadService.getImageUrl(img.originalCid),
      thumbnails: {
        small: {
          cid: img.thumbnailSmallCid,
          url: this.imageUploadService.getImageUrl(img.thumbnailSmallCid),
          dimensions: '150x150'
        },
        medium: {
          cid: img.thumbnailMediumCid,
          url: this.imageUploadService.getImageUrl(img.thumbnailMediumCid),
          dimensions: '400x400'
        },
        large: {
          cid: img.thumbnailLargeCid,
          url: this.imageUploadService.getImageUrl(img.thumbnailLargeCid),
          dimensions: '800x800'
        }
      }
    });

    return {
      id: product.id,
      userId: product.userId,
      productName: product.productName,
      description: product.description,
      category: product.category,
      brand: product.brand,
      model: product.model,
      serialNumber: product.serialNumber,
      batchNumber: product.batchNumber,
      manufacturerName: product.manufacturerName,
      manufacturerAddress: product.manufacturerAddress,
      originCountry: product.originCountry,
      tags: product.tags,
      additionalMetadata: product.additionalMetadata ? JSON.parse(product.additionalMetadata) : null,
      images: {
        primary: primaryImages.length > 0 ? transformImage(primaryImages[0]) : null,
        additional: additionalImages.map(transformImage),
        certificates: certificateImages.map(transformImage)
      },
      metadata: metadata ? {
        totalImages: metadata.totalImages,
        totalStorageSize: metadata.totalStorageSize,
        ipfsHashes: JSON.parse(metadata.ipfsHashes),
        checksums: JSON.parse(metadata.checksums)
      } : null,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    };
  }

  /**
   * Update product information
   */
  async updateProduct(productId: string, userId: string, updates: Partial<ProductRegistrationRequest>): Promise<boolean> {
    // Convert additionalMetadata to JSON string if present
    const dbUpdates = {
      ...updates,
      additionalMetadata: updates.additionalMetadata ? JSON.stringify(updates.additionalMetadata) : undefined
    };

    return await this.productModel.updateProduct(productId, userId, dbUpdates);
  }

  /**
   * Add images to existing product
   */
  async addProductImages(
    productId: string,
    userId: string,
    files: Express.Multer.File[]
  ): Promise<{
    success: boolean;
    newImages: number;
    totalImages: number;
    additionalStorageSize: number;
    totalStorageSize: number;
  }> {
    // Verify user owns the product
    const userOwns = await this.productModel.userOwnsProduct(productId, userId);
    if (!userOwns) {
      throw new Error('Product not found or access denied');
    }

    console.log(`📸 Adding ${files.length} images to product: ${productId}`);

    // Process new images
    const imageRecords: Omit<ProductImageData, 'createdAt'>[] = [];
    let additionalStorageSize = 0;
    const newIpfsHashes: string[] = [];
    const newChecksums: Record<string, string> = {};

    for (const file of files) {
      const processedImage = await this.imageUploadService.uploadImageToIPFS(
        file.buffer,
        file.originalname,
        file.mimetype,
        true,
        true
      );

      const imageRecord: Omit<ProductImageData, 'createdAt'> = {
        id: uuidv4(),
        productId,
        imageType: 'additional',
        originalCid: processedImage.originalImage.cid,
        optimizedCid: processedImage.optimizedImage.cid,
        thumbnailSmallCid: processedImage.thumbnails.small.cid,
        thumbnailMediumCid: processedImage.thumbnails.medium.cid,
        thumbnailLargeCid: processedImage.thumbnails.large.cid,
        originalName: file.originalname,
        size: processedImage.originalImage.size,
        checksum: processedImage.checksums.original
      };

      imageRecords.push(imageRecord);
      additionalStorageSize += processedImage.originalImage.size;
      newIpfsHashes.push(processedImage.originalImage.cid);
      newChecksums[processedImage.originalImage.cid] = processedImage.checksums.original;
    }

    // Save new image records
    const imagesAdded = await this.productModel.addProductImages(imageRecords);
    if (!imagesAdded) {
      throw new Error('Failed to save new images');
    }

    // Update metadata
    const currentMetadata = await this.productModel.getProductMetadata(productId);
    if (currentMetadata) {
      const currentHashes = JSON.parse(currentMetadata.ipfsHashes);
      const currentChecksums = JSON.parse(currentMetadata.checksums);

      const updatedMetadata: Omit<ProductMetadata, 'id' | 'createdAt' | 'updatedAt'> = {
        productId,
        totalImages: currentMetadata.totalImages + files.length,
        totalStorageSize: currentMetadata.totalStorageSize + additionalStorageSize,
        ipfsHashes: JSON.stringify([...currentHashes, ...newIpfsHashes]),
        checksums: JSON.stringify({ ...currentChecksums, ...newChecksums }),
        lastImageUpload: new Date()
      };

      await this.productModel.upsertProductMetadata(updatedMetadata);

      return {
        success: true,
        newImages: files.length,
        totalImages: updatedMetadata.totalImages,
        additionalStorageSize,
        totalStorageSize: updatedMetadata.totalStorageSize
      };
    } else {
      // Create new metadata if it doesn't exist
      const newMetadata: Omit<ProductMetadata, 'id' | 'createdAt' | 'updatedAt'> = {
        productId,
        totalImages: files.length,
        totalStorageSize: additionalStorageSize,
        ipfsHashes: JSON.stringify(newIpfsHashes),
        checksums: JSON.stringify(newChecksums),
        lastImageUpload: new Date()
      };

      await this.productModel.upsertProductMetadata(newMetadata);

      return {
        success: true,
        newImages: files.length,
        totalImages: files.length,
        additionalStorageSize,
        totalStorageSize: additionalStorageSize
      };
    }
  }

  /**
   * Delete product and all associated data
   */
  async deleteProduct(productId: string, userId: string): Promise<{
    success: boolean;
    deletedImages: number;
    totalImages: number;
  }> {
    // Get product metadata to know which images to delete
    const metadata = await this.productModel.getProductMetadata(productId);
    let deletedImages = 0;
    let totalImages = 0;

    if (metadata) {
      const ipfsHashes = JSON.parse(metadata.ipfsHashes) as string[];
      totalImages = ipfsHashes.length;

      // Attempt to delete images from IPFS
      for (const cid of ipfsHashes) {
        try {
          const deleted = await this.imageUploadService.deleteImage(cid);
          if (deleted) deletedImages++;
        } catch (error) {
          console.warn(`Failed to delete image from IPFS: ${cid}`, error);
        }
      }
    }

    // Delete product record (cascades to images and metadata)
    const productDeleted = await this.productModel.deleteProduct(productId, userId);
    if (!productDeleted) {
      throw new Error('Failed to delete product or product not found');
    }

    console.log(`🗑️ Product deleted: ${productId} (${deletedImages}/${totalImages} images removed from IPFS)`);

    return {
      success: true,
      deletedImages,
      totalImages
    };
  }

  /**
   * Check if user owns a product
   */
  async userOwnsProduct(productId: string, userId: string): Promise<boolean> {
    return await this.productModel.userOwnsProduct(productId, userId);
  }

  /**
   * Get catalog filter options
   */
  async getCatalogFilters(): Promise<{
    categories: string[];
    countries: string[];
    locations: string[];
    totalProducts: number;
  }> {
    return await this.productModel.getCatalogFilters();
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    const imageServiceHealth = await this.imageUploadService.healthCheck();
    const productStats = await this.productModel.getProductStats();

    return {
      status: imageServiceHealth.status === 'healthy' ? 'healthy' : 'degraded',
      services: {
        imageUpload: imageServiceHealth,
        database: {
          status: 'healthy',
          stats: productStats
        }
      }
    };
  }
}

export default ProductService;