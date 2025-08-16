import { NftMetadata, NftValidationResult } from '../types/nftTypes';
import crypto from 'crypto';

/**
 * NFT Metadata Validation Rules
 */
export interface ValidationRules {
  maxNameLength: number;
  maxDescriptionLength: number;
  maxImageSize: number; // bytes
  requiredAttributes: string[];
  allowedImageFormats: string[];
  maxMetadataSize: number; // bytes
  requireIpfsUrls: boolean;
}

/**
 * Default validation rules for AfriChain NFT metadata
 */
export const DEFAULT_VALIDATION_RULES: ValidationRules = {
  maxNameLength: 100,
  maxDescriptionLength: 1000,
  maxImageSize: 5 * 1024 * 1024, // 5MB
  requiredAttributes: ['category', 'manufacturer'],
  allowedImageFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxMetadataSize: 100 * 1024, // 100KB
  requireIpfsUrls: true
};

/**
 * NFT Metadata Validator
 * Comprehensive validation for AfriChain NFT metadata
 */
export class NftMetadataValidator {
  private rules: ValidationRules;

  constructor(rules: ValidationRules = DEFAULT_VALIDATION_RULES) {
    this.rules = rules;
  }

  /**
   * Validate complete NFT metadata
   */
  async validateMetadata(metadata: NftMetadata): Promise<NftValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      console.log('🔍 Validating NFT metadata...');

      // Basic structure validation
      await this.validateBasicStructure(metadata, errors);

      // Content validation
      await this.validateContent(metadata, errors, warnings);

      // Properties validation
      await this.validateProperties(metadata, errors, warnings);

      // Attributes validation
      await this.validateAttributes(metadata, errors, warnings);

      // Media validation
      await this.validateMedia(metadata, errors, warnings);

      // Size validation
      await this.validateSize(metadata, errors, warnings);

      // IPFS validation
      if (this.rules.requireIpfsUrls) {
        await this.validateIpfsUrls(metadata, errors, warnings);
      }

      const isValid = errors.length === 0;
      const result: NftValidationResult = {
        isValid,
        errors,
        warnings,
        metadata: {
          isValidFormat: true,
          hasRequiredFields: this.hasRequiredFields(metadata),
          ipfsLinksValid: this.validateIpfsLinksSync(metadata),
          totalSize: JSON.stringify(metadata).length
        }
      };

      if (isValid) {
        console.log('✅ Metadata validation passed');
      } else {
        console.log(`❌ Metadata validation failed: ${errors.length} errors`);
      }

      return result;

    } catch (error) {
      console.error('❌ Metadata validation error:', error);
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed'],
        warnings: [],
        metadata: {
          isValidFormat: false,
          hasRequiredFields: false,
          ipfsLinksValid: false,
          totalSize: 0
        }
      };
    }
  }

  /**
   * Validate basic metadata structure
   */
  private async validateBasicStructure(metadata: NftMetadata, errors: string[]): Promise<void> {
    // Required top-level fields
    if (!metadata.name || typeof metadata.name !== 'string') {
      errors.push('Name is required and must be a string');
    }

    if (!metadata.description || typeof metadata.description !== 'string') {
      errors.push('Description is required and must be a string');
    }

    if (!metadata.image || typeof metadata.image !== 'string') {
      errors.push('Image URL is required and must be a string');
    }

    // Properties must be an object
    if (!metadata.properties || typeof metadata.properties !== 'object') {
      errors.push('Properties object is required');
    }

    // Attributes must be an array
    if (!Array.isArray(metadata.attributes)) {
      errors.push('Attributes must be an array');
    }
  }

  /**
   * Validate content fields
   */
  private async validateContent(metadata: NftMetadata, errors: string[], warnings: string[]): Promise<void> {
    // Name validation
    if (metadata.name) {
      if (metadata.name.length > this.rules.maxNameLength) {
        errors.push(`Name must be ${this.rules.maxNameLength} characters or less`);
      }
      if (metadata.name.trim().length === 0) {
        errors.push('Name cannot be empty or only whitespace');
      }
    }

    // Description validation
    if (metadata.description) {
      if (metadata.description.length > this.rules.maxDescriptionLength) {
        errors.push(`Description must be ${this.rules.maxDescriptionLength} characters or less`);
      }
      if (metadata.description.trim().length === 0) {
        errors.push('Description cannot be empty or only whitespace');
      }
    }

    // External URL validation (optional)
    if (metadata.external_url && !this.isValidUrl(metadata.external_url)) {
      warnings.push('External URL format may be invalid');
    }
  }

  /**
   * Validate properties object
   */
  private async validateProperties(metadata: NftMetadata, errors: string[], warnings: string[]): Promise<void> {
    if (!metadata.properties) return;

    const props = metadata.properties;

    // Required properties
    if (!props.productId || typeof props.productId !== 'string') {
      errors.push('properties.productId is required and must be a string');
    }

    if (!props.productName || typeof props.productName !== 'string') {
      errors.push('properties.productName is required and must be a string');
    }

    if (!props.category || typeof props.category !== 'string') {
      errors.push('properties.category is required and must be a string');
    }

    // Manufacturer validation
    if (!props.manufacturer || typeof props.manufacturer !== 'object') {
      errors.push('properties.manufacturer is required and must be an object');
    } else {
      if (!props.manufacturer.name) {
        warnings.push('Manufacturer name is recommended');
      }
      if (!props.manufacturer.country) {
        warnings.push('Manufacturer country is recommended');
      }
    }

    // Registration validation
    if (!props.registration || typeof props.registration !== 'object') {
      errors.push('properties.registration is required and must be an object');
    } else {
      if (!props.registration.timestamp) {
        errors.push('Registration timestamp is required');
      } else if (!this.isValidISODate(props.registration.timestamp)) {
        errors.push('Registration timestamp must be a valid ISO8601 date');
      }

      if (!props.registration.registrar) {
        errors.push('Registration registrar (user ID) is required');
      }

      if (!props.registration.platform) {
        warnings.push('Registration platform is recommended');
      }
    }

    // Authenticity validation
    if (!props.authenticity || typeof props.authenticity !== 'object') {
      errors.push('properties.authenticity is required and must be an object');
    } else {
      if (typeof props.authenticity.verified !== 'boolean') {
        errors.push('Authenticity verified status must be a boolean');
      }

      if (!props.authenticity.verificationMethod) {
        errors.push('Verification method is required');
      }

      if (!props.authenticity.verificationDate) {
        warnings.push('Verification date is recommended');
      } else if (!this.isValidISODate(props.authenticity.verificationDate)) {
        warnings.push('Verification date should be a valid ISO8601 date');
      }
    }
  }

  /**
   * Validate attributes array
   */
  private async validateAttributes(metadata: NftMetadata, errors: string[], warnings: string[]): Promise<void> {
    if (!Array.isArray(metadata.attributes)) return;

    metadata.attributes.forEach((attr, index) => {
      if (!attr.trait_type || typeof attr.trait_type !== 'string') {
        errors.push(`Attribute ${index}: trait_type is required and must be a string`);
      }

      if (attr.value === undefined || attr.value === null) {
        errors.push(`Attribute ${index}: value is required`);
      }

      if (attr.display_type && !['number', 'boost_percentage', 'boost_number', 'date'].includes(attr.display_type)) {
        warnings.push(`Attribute ${index}: unknown display_type "${attr.display_type}"`);
      }

      if (attr.display_type === 'date' && typeof attr.value === 'string') {
        if (!this.isValidISODate(attr.value)) {
          warnings.push(`Attribute ${index}: date value should be a valid ISO8601 date`);
        }
      }
    });

    // Check for required attributes
    this.rules.requiredAttributes.forEach(requiredAttr => {
      const hasAttribute = metadata.attributes.some(attr => 
        attr.trait_type.toLowerCase() === requiredAttr.toLowerCase()
      );
      
      if (!hasAttribute) {
        warnings.push(`Recommended attribute "${requiredAttr}" is missing`);
      }
    });
  }

  /**
   * Validate media in properties
   */
  private async validateMedia(metadata: NftMetadata, errors: string[], warnings: string[]): Promise<void> {
    if (!metadata.properties?.media) return;

    const media = metadata.properties.media;

    // Images validation
    if (media.images && Array.isArray(media.images)) {
      media.images.forEach((image, index) => {
        if (!image.type || !['primary', 'additional', 'certificate'].includes(image.type)) {
          errors.push(`Media image ${index}: type must be 'primary', 'additional', or 'certificate'`);
        }

        if (!image.ipfs || typeof image.ipfs !== 'string') {
          errors.push(`Media image ${index}: IPFS URL is required`);
        }

        if (!image.thumbnails || typeof image.thumbnails !== 'object') {
          warnings.push(`Media image ${index}: thumbnails are recommended`);
        } else {
          if (!image.thumbnails.small || !image.thumbnails.medium || !image.thumbnails.large) {
            warnings.push(`Media image ${index}: all thumbnail sizes (small, medium, large) are recommended`);
          }
        }
      });

      // Check for primary image
      const hasPrimary = media.images.some(img => img.type === 'primary');
      if (!hasPrimary) {
        warnings.push('At least one primary image is recommended');
      }
    }

    // Certificates validation
    if (media.certificates && Array.isArray(media.certificates)) {
      media.certificates.forEach((cert, index) => {
        if (typeof cert !== 'string') {
          errors.push(`Certificate ${index}: must be a string (IPFS URL)`);
        }
      });
    }
  }

  /**
   * Validate metadata size
   */
  private async validateSize(metadata: NftMetadata, errors: string[], warnings: string[]): Promise<void> {
    const metadataString = JSON.stringify(metadata);
    const sizeInBytes = Buffer.byteLength(metadataString, 'utf8');

    if (sizeInBytes > this.rules.maxMetadataSize) {
      errors.push(`Metadata size (${sizeInBytes} bytes) exceeds maximum allowed size (${this.rules.maxMetadataSize} bytes)`);
    }

    if (sizeInBytes > this.rules.maxMetadataSize * 0.8) {
      warnings.push(`Metadata size is approaching the limit (${sizeInBytes}/${this.rules.maxMetadataSize} bytes)`);
    }
  }

  /**
   * Validate IPFS URLs
   */
  private async validateIpfsUrls(metadata: NftMetadata, errors: string[], warnings: string[]): Promise<void> {
    const ipfsUrls: string[] = [];

    // Main image
    if (metadata.image) {
      ipfsUrls.push(metadata.image);
    }

    // Media images
    if (metadata.properties?.media?.images) {
      metadata.properties.media.images.forEach(image => {
        if (image.ipfs) ipfsUrls.push(image.ipfs);
        if (image.thumbnails) {
          Object.values(image.thumbnails).forEach(url => {
            if (typeof url === 'string') ipfsUrls.push(url);
          });
        }
      });
    }

    // Certificates
    if (metadata.properties?.media?.certificates) {
      ipfsUrls.push(...metadata.properties.media.certificates);
    }

    // Validate each IPFS URL
    ipfsUrls.forEach((url, index) => {
      if (!this.isValidIpfsUrl(url)) {
        errors.push(`Invalid IPFS URL format: ${url}`);
      }
    });
  }

  /**
   * Generate metadata hash
   */
  generateMetadataHash(metadata: NftMetadata): string {
    const metadataString = JSON.stringify(metadata, Object.keys(metadata).sort());
    return crypto.createHash('sha256').update(metadataString).digest('hex');
  }

  /**
   * Sanitize metadata by removing invalid fields
   */
  sanitizeMetadata(metadata: NftMetadata): NftMetadata {
    const sanitized = JSON.parse(JSON.stringify(metadata));

    // Trim string fields
    if (sanitized.name) sanitized.name = sanitized.name.trim();
    if (sanitized.description) sanitized.description = sanitized.description.trim();
    if (sanitized.image) sanitized.image = sanitized.image.trim();
    if (sanitized.external_url) sanitized.external_url = sanitized.external_url.trim();

    // Ensure attributes is an array
    if (!Array.isArray(sanitized.attributes)) {
      sanitized.attributes = [];
    }

    // Clean attributes
    sanitized.attributes = sanitized.attributes.filter((attr: any) => 
      attr && typeof attr === 'object' && attr.trait_type && attr.value !== undefined
    );

    return sanitized;
  }

  /**
   * Check if metadata has all required fields
   */
  private hasRequiredFields(metadata: NftMetadata): boolean {
    return !!(
      metadata.name &&
      metadata.description &&
      metadata.image &&
      metadata.properties?.productId &&
      metadata.properties?.productName &&
      metadata.properties?.category &&
      metadata.properties?.registration?.timestamp &&
      metadata.properties?.registration?.registrar &&
      metadata.properties?.authenticity &&
      typeof metadata.properties.authenticity.verified === 'boolean'
    );
  }

  /**
   * Validate IPFS URLs synchronously
   */
  private validateIpfsLinksSync(metadata: NftMetadata): boolean {
    try {
      const urls = this.extractIpfsUrls(metadata);
      return urls.every(url => this.isValidIpfsUrl(url));
    } catch {
      return false;
    }
  }

  /**
   * Extract all IPFS URLs from metadata
   */
  private extractIpfsUrls(metadata: NftMetadata): string[] {
    const urls: string[] = [];

    if (metadata.image) urls.push(metadata.image);
    
    if (metadata.properties?.media?.images) {
      metadata.properties.media.images.forEach(image => {
        if (image.ipfs) urls.push(image.ipfs);
        if (image.thumbnails) {
          Object.values(image.thumbnails).forEach(url => {
            if (typeof url === 'string') urls.push(url);
          });
        }
      });
    }

    if (metadata.properties?.media?.certificates) {
      urls.push(...metadata.properties.media.certificates);
    }

    return urls;
  }

  /**
   * Validate IPFS URL format
   */
  private isValidIpfsUrl(url: string): boolean {
    const ipfsPatterns = [
      /^ipfs:\/\/[a-zA-Z0-9]{46,}$/,  // ipfs://QmHash
      /^https:\/\/ipfs\.io\/ipfs\/[a-zA-Z0-9]{46,}$/,  // IPFS gateway
      /^https:\/\/gateway\.pinata\.cloud\/ipfs\/[a-zA-Z0-9]{46,}$/,  // Pinata gateway
      /^https:\/\/[a-zA-Z0-9-]+\.ipfs\.w3s\.link$/,  // Web3.Storage gateway
      /^https:\/\/[a-zA-Z0-9]{46,}\.ipfs\.dweb\.link$/  // DWEB gateway
    ];

    return ipfsPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate ISO8601 date format
   */
  private isValidISODate(dateString: string): boolean {
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    if (!isoDateRegex.test(dateString)) return false;

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Update validation rules
   */
  updateRules(newRules: Partial<ValidationRules>): void {
    this.rules = { ...this.rules, ...newRules };
    console.log('✅ Validation rules updated');
  }

  /**
   * Get current validation rules
   */
  getRules(): ValidationRules {
    return { ...this.rules };
  }
}

// Create singleton instance
let validator: NftMetadataValidator | null = null;

/**
 * Get singleton metadata validator instance
 */
export const getNftMetadataValidator = (rules?: ValidationRules): NftMetadataValidator => {
  if (!validator) {
    validator = new NftMetadataValidator(rules);
  }
  return validator;
};

/**
 * Validate metadata with default rules
 */
export const validateNftMetadata = async (metadata: NftMetadata): Promise<NftValidationResult> => {
  const validator = getNftMetadataValidator();
  return await validator.validateMetadata(metadata);
};

/**
 * Generate standardized metadata hash
 */
export const generateMetadataHash = (metadata: NftMetadata): string => {
  const validator = getNftMetadataValidator();
  return validator.generateMetadataHash(metadata);
};

export default NftMetadataValidator;