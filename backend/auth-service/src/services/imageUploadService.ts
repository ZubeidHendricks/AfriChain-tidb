import sharp from 'sharp';
import IPFSClient from '../config/ipfs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface ImageMetadata {
  originalName: string;
  mimetype: string;
  size: number;
  width?: number;
  height?: number;
  format?: string;
}

export interface ProcessedImage {
  id: string;
  originalImage: {
    cid: string;
    metadata: ImageMetadata;
    size: number;
  };
  thumbnails: {
    small: { cid: string; size: number; dimensions: string };
    medium: { cid: string; size: number; dimensions: string };
    large: { cid: string; size: number; dimensions: string };
  };
  optimizedImage: {
    cid: string;
    size: number;
    compressionRatio: number;
  };
  checksums: {
    original: string;
    optimized: string;
  };
  uploadedAt: Date;
}

export interface ImageValidationError {
  field: string;
  message: string;
  code: string;
}

class ImageUploadService {
  private ipfsClient: IPFSClient;

  // Configuration constants
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MIN_FILE_SIZE = 1024; // 1KB
  private readonly ALLOWED_FORMATS = ['jpeg', 'jpg', 'png', 'webp'];
  private readonly MAX_DIMENSION = 4096; // 4K max resolution
  private readonly MIN_DIMENSION = 100; // Minimum 100px

  // Thumbnail sizes
  private readonly THUMBNAIL_SIZES = {
    small: { width: 150, height: 150 },
    medium: { width: 400, height: 400 },
    large: { width: 800, height: 800 }
  };

  constructor() {
    this.ipfsClient = IPFSClient.getInstance();
  }

  /**
   * Validate uploaded image file
   */
  async validateImage(buffer: Buffer, originalName: string, mimetype: string): Promise<{
    isValid: boolean;
    errors: ImageValidationError[];
    metadata?: ImageMetadata;
  }> {
    const errors: ImageValidationError[] = [];

    try {
      // Check file size
      if (buffer.length > this.MAX_FILE_SIZE) {
        errors.push({
          field: 'size',
          message: `File size exceeds maximum limit of ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`,
          code: 'FILE_TOO_LARGE'
        });
      }

      if (buffer.length < this.MIN_FILE_SIZE) {
        errors.push({
          field: 'size',
          message: `File size is below minimum limit of ${this.MIN_FILE_SIZE} bytes`,
          code: 'FILE_TOO_SMALL'
        });
      }

      // Check file format using Sharp
      const imageInfo = await sharp(buffer).metadata();

      if (!imageInfo.format) {
        errors.push({
          field: 'format',
          message: 'Invalid image format or corrupted file',
          code: 'INVALID_FORMAT'
        });
        return { isValid: false, errors };
      }

      // Check allowed formats
      if (!this.ALLOWED_FORMATS.includes(imageInfo.format)) {
        errors.push({
          field: 'format',
          message: `Unsupported format. Allowed: ${this.ALLOWED_FORMATS.join(', ')}`,
          code: 'UNSUPPORTED_FORMAT'
        });
      }

      // Check dimensions
      if (imageInfo.width && imageInfo.height) {
        if (imageInfo.width > this.MAX_DIMENSION || imageInfo.height > this.MAX_DIMENSION) {
          errors.push({
            field: 'dimensions',
            message: `Image dimensions exceed maximum ${this.MAX_DIMENSION}x${this.MAX_DIMENSION} pixels`,
            code: 'DIMENSIONS_TOO_LARGE'
          });
        }

        if (imageInfo.width < this.MIN_DIMENSION || imageInfo.height < this.MIN_DIMENSION) {
          errors.push({
            field: 'dimensions',
            message: `Image dimensions below minimum ${this.MIN_DIMENSION}x${this.MIN_DIMENSION} pixels`,
            code: 'DIMENSIONS_TOO_SMALL'
          });
        }
      }

      // Check MIME type consistency
      const expectedMimetypes = {
        jpeg: ['image/jpeg', 'image/jpg'],
        jpg: ['image/jpeg', 'image/jpg'],
        png: ['image/png'],
        webp: ['image/webp']
      };

      const expectedMimes = expectedMimetypes[imageInfo.format as keyof typeof expectedMimetypes] || [];
      if (expectedMimes.length > 0 && !expectedMimes.includes(mimetype)) {
        errors.push({
          field: 'mimetype',
          message: `MIME type mismatch. Expected ${expectedMimes.join(' or ')}, got ${mimetype}`,
          code: 'MIMETYPE_MISMATCH'
        });
      }

      const metadata: ImageMetadata = {
        originalName,
        mimetype,
        size: buffer.length,
        width: imageInfo.width,
        height: imageInfo.height,
        format: imageInfo.format
      };

      return {
        isValid: errors.length === 0,
        errors,
        metadata: errors.length === 0 ? metadata : undefined
      };

    } catch (error) {
      console.error('Image validation error:', error);
      errors.push({
        field: 'file',
        message: 'Failed to process image file',
        code: 'PROCESSING_ERROR'
      });
      return { isValid: false, errors };
    }
  }

  /**
   * Generate optimized version of the image
   */
  async optimizeImage(buffer: Buffer, format?: 'jpeg' | 'png' | 'webp'): Promise<{
    buffer: Buffer;
    size: number;
    compressionRatio: number;
  }> {
    try {
      let sharpInstance = sharp(buffer);
      const originalSize = buffer.length;

      // Apply format conversion if specified, otherwise keep original format
      if (format) {
        switch (format) {
          case 'jpeg':
            sharpInstance = sharpInstance.jpeg({ 
              quality: 85, 
              progressive: true,
              mozjpeg: true 
            });
            break;
          case 'png':
            sharpInstance = sharpInstance.png({ 
              quality: 85,
              progressive: true,
              compressionLevel: 8 
            });
            break;
          case 'webp':
            sharpInstance = sharpInstance.webp({ 
              quality: 85,
              effort: 4 
            });
            break;
        }
      } else {
        // Apply format-specific optimization
        const metadata = await sharp(buffer).metadata();
        if (metadata.format === 'jpeg') {
          sharpInstance = sharpInstance.jpeg({ quality: 85, progressive: true });
        } else if (metadata.format === 'png') {
          sharpInstance = sharpInstance.png({ quality: 85, compressionLevel: 8 });
        }
      }

      const optimizedBuffer = await sharpInstance.toBuffer();
      const compressionRatio = (originalSize - optimizedBuffer.length) / originalSize;

      return {
        buffer: optimizedBuffer,
        size: optimizedBuffer.length,
        compressionRatio: Math.max(0, compressionRatio)
      };

    } catch (error) {
      console.error('Image optimization error:', error);
      throw new Error('Failed to optimize image');
    }
  }

  /**
   * Generate thumbnails in different sizes
   */
  async generateThumbnails(buffer: Buffer): Promise<{
    small: { buffer: Buffer; size: number; dimensions: string };
    medium: { buffer: Buffer; size: number; dimensions: string };
    large: { buffer: Buffer; size: number; dimensions: string };
  }> {
    try {
      const thumbnails = await Promise.all([
        this.createThumbnail(buffer, this.THUMBNAIL_SIZES.small),
        this.createThumbnail(buffer, this.THUMBNAIL_SIZES.medium),
        this.createThumbnail(buffer, this.THUMBNAIL_SIZES.large)
      ]);

      return {
        small: {
          buffer: thumbnails[0],
          size: thumbnails[0].length,
          dimensions: `${this.THUMBNAIL_SIZES.small.width}x${this.THUMBNAIL_SIZES.small.height}`
        },
        medium: {
          buffer: thumbnails[1],
          size: thumbnails[1].length,
          dimensions: `${this.THUMBNAIL_SIZES.medium.width}x${this.THUMBNAIL_SIZES.medium.height}`
        },
        large: {
          buffer: thumbnails[2],
          size: thumbnails[2].length,
          dimensions: `${this.THUMBNAIL_SIZES.large.width}x${this.THUMBNAIL_SIZES.large.height}`
        }
      };

    } catch (error) {
      console.error('Thumbnail generation error:', error);
      throw new Error('Failed to generate thumbnails');
    }
  }

  /**
   * Create a single thumbnail
   */
  private async createThumbnail(
    buffer: Buffer, 
    size: { width: number; height: number }
  ): Promise<Buffer> {
    return await sharp(buffer)
      .resize(size.width, size.height, {
        fit: 'inside',
        withoutEnlargement: true,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
  }

  /**
   * Calculate file checksum
   */
  calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Upload image and all variants to IPFS
   */
  async uploadImageToIPFS(
    buffer: Buffer,
    originalName: string,
    mimetype: string,
    generateOptimized: boolean = true,
    generateThumbnails: boolean = true
  ): Promise<ProcessedImage> {
    try {
      // Validate the image first
      const validation = await this.validateImage(buffer, originalName, mimetype);
      if (!validation.isValid) {
        throw new Error(`Image validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      const imageId = uuidv4();
      const originalChecksum = this.calculateChecksum(buffer);

      console.log(`Processing image: ${originalName} (${buffer.length} bytes)`);

      // Upload original image to IPFS
      const originalUpload = await this.ipfsClient.uploadContent(buffer);
      console.log(`Original image uploaded to IPFS: ${originalUpload.cid}`);

      const result: ProcessedImage = {
        id: imageId,
        originalImage: {
          cid: originalUpload.cid,
          metadata: validation.metadata!,
          size: originalUpload.size
        },
        thumbnails: {
          small: { cid: '', size: 0, dimensions: '' },
          medium: { cid: '', size: 0, dimensions: '' },
          large: { cid: '', size: 0, dimensions: '' }
        },
        optimizedImage: {
          cid: '',
          size: 0,
          compressionRatio: 0
        },
        checksums: {
          original: originalChecksum,
          optimized: ''
        },
        uploadedAt: new Date()
      };

      // Generate and upload optimized image
      if (generateOptimized) {
        try {
          const optimized = await this.optimizeImage(buffer);
          const optimizedUpload = await this.ipfsClient.uploadContent(optimized.buffer);
          
          result.optimizedImage = {
            cid: optimizedUpload.cid,
            size: optimized.size,
            compressionRatio: optimized.compressionRatio
          };
          result.checksums.optimized = this.calculateChecksum(optimized.buffer);
          
          console.log(`Optimized image uploaded: ${optimizedUpload.cid} (${optimized.compressionRatio.toFixed(2)}% compression)`);
        } catch (error) {
          console.warn('Failed to generate optimized image:', error);
          // Continue without optimized version
        }
      }

      // Generate and upload thumbnails
      if (generateThumbnails) {
        try {
          const thumbnails = await this.generateThumbnails(buffer);
          
          const [smallUpload, mediumUpload, largeUpload] = await Promise.all([
            this.ipfsClient.uploadContent(thumbnails.small.buffer),
            this.ipfsClient.uploadContent(thumbnails.medium.buffer),
            this.ipfsClient.uploadContent(thumbnails.large.buffer)
          ]);

          result.thumbnails = {
            small: {
              cid: smallUpload.cid,
              size: thumbnails.small.size,
              dimensions: thumbnails.small.dimensions
            },
            medium: {
              cid: mediumUpload.cid,
              size: thumbnails.medium.size,
              dimensions: thumbnails.medium.dimensions
            },
            large: {
              cid: largeUpload.cid,
              size: thumbnails.large.size,
              dimensions: thumbnails.large.dimensions
            }
          };

          console.log(`Thumbnails uploaded: ${smallUpload.cid}, ${mediumUpload.cid}, ${largeUpload.cid}`);
        } catch (error) {
          console.warn('Failed to generate thumbnails:', error);
          // Continue without thumbnails
        }
      }

      console.log(`✅ Image processing complete for ${originalName}`);
      return result;

    } catch (error) {
      console.error('Image upload to IPFS failed:', error);
      throw error;
    }
  }

  /**
   * Upload multiple images in batch
   */
  async uploadMultipleImages(
    images: Array<{
      buffer: Buffer;
      originalName: string;
      mimetype: string;
    }>,
    generateOptimized: boolean = true,
    generateThumbnails: boolean = true
  ): Promise<{
    successful: ProcessedImage[];
    failed: Array<{
      originalName: string;
      error: string;
    }>;
  }> {
    const successful: ProcessedImage[] = [];
    const failed: Array<{ originalName: string; error: string }> = [];

    for (const image of images) {
      try {
        const result = await this.uploadImageToIPFS(
          image.buffer,
          image.originalName,
          image.mimetype,
          generateOptimized,
          generateThumbnails
        );
        successful.push(result);
      } catch (error) {
        failed.push({
          originalName: image.originalName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { successful, failed };
  }

  /**
   * Retrieve image from IPFS
   */
  async getImageFromIPFS(cid: string): Promise<Buffer> {
    try {
      const content = await this.ipfsClient.getContent(cid);
      return Buffer.from(content);
    } catch (error) {
      console.error('Failed to retrieve image from IPFS:', error);
      throw new Error('Image retrieval failed');
    }
  }

  /**
   * Check if image exists in IPFS
   */
  async imageExists(cid: string): Promise<boolean> {
    return await this.ipfsClient.contentExists(cid);
  }

  /**
   * Get image information without downloading
   */
  async getImageInfo(cid: string): Promise<{
    exists: boolean;
    metadata?: ImageMetadata;
  }> {
    try {
      const exists = await this.imageExists(cid);
      if (!exists) {
        return { exists: false };
      }

      // For getting metadata, we'd need to download a small portion
      // or store metadata separately. For now, just return exists status
      return { exists: true };

    } catch (error) {
      return { exists: false };
    }
  }

  /**
   * Delete/unpin image from IPFS
   */
  async deleteImage(cid: string): Promise<boolean> {
    try {
      return await this.ipfsClient.unpinContent(cid);
    } catch (error) {
      console.error('Failed to delete image from IPFS:', error);
      return false;
    }
  }

  /**
   * Get IPFS gateway URL for image
   */
  getImageUrl(cid: string): string {
    return this.ipfsClient.getGatewayUrl(cid);
  }

  /**
   * Health check for image upload service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    ipfs: any;
    imageProcessing: boolean;
  }> {
    try {
      const ipfsHealth = await this.ipfsClient.healthCheck();
      
      // Test image processing with a small test image
      let imageProcessing = true;
      try {
        // Create a simple 1x1 pixel PNG for testing
        const testBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
        await sharp(testBuffer).metadata();
      } catch {
        imageProcessing = false;
      }

      return {
        status: ipfsHealth.status === 'healthy' && imageProcessing ? 'healthy' : 'unhealthy',
        ipfs: ipfsHealth,
        imageProcessing
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        ipfs: { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error' },
        imageProcessing: false
      };
    }
  }
}

export default ImageUploadService;