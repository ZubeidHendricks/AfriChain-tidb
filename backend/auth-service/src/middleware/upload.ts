import multer from 'multer';
import { Request, Response, NextFunction } from 'express';

export interface MulterRequest extends Request {
  files?: {
    [fieldname: string]: Express.Multer.File[];
  } | Express.Multer.File[];
  file?: Express.Multer.File;
}

// Configuration for product image uploads
const productImageUpload = multer({
  storage: multer.memoryStorage(), // Store in memory for processing
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10, // Maximum 10 files per request
    fields: 20 // Maximum 20 non-file fields
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Check MIME type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/webp'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedMimeTypes.join(', ')}`));
    }
  }
});

// Middleware for single product image upload
export const uploadSingleProductImage = productImageUpload.single('productImage');

// Middleware for multiple product images upload (up to 10 images)
export const uploadMultipleProductImages = productImageUpload.array('productImages', 10);

// Middleware for mixed product data with multiple images
export const uploadProductData = productImageUpload.fields([
  { name: 'primaryImage', maxCount: 1 },
  { name: 'additionalImages', maxCount: 9 },
  { name: 'certificateImages', maxCount: 5 }
]);

// Error handler middleware for multer errors
export const handleUploadError = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (error instanceof multer.MulterError) {
    let message = 'File upload error';
    let statusCode = 400;

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File size too large. Maximum size: 10MB';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files. Maximum allowed: 10 files';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field';
        break;
      case 'LIMIT_PART_COUNT':
        message = 'Too many parts in multipart data';
        break;
      case 'LIMIT_FIELD_KEY':
        message = 'Field name too long';
        break;
      case 'LIMIT_FIELD_VALUE':
        message = 'Field value too long';
        break;
      case 'LIMIT_FIELD_COUNT':
        message = 'Too many fields';
        break;
      default:
        message = `Upload error: ${error.message}`;
    }

    res.status(statusCode).json({
      success: false,
      error: message,
      code: error.code
    });
    return;
  }

  if (error) {
    res.status(400).json({
      success: false,
      error: error.message || 'File upload failed'
    });
    return;
  }

  next();
};

// Middleware to validate uploaded files are present
export const requireProductImages = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const multerReq = req as MulterRequest;
  
  // Check if any files were uploaded
  const hasFiles = multerReq.file || 
                   (Array.isArray(multerReq.files) && multerReq.files.length > 0) ||
                   (multerReq.files && typeof multerReq.files === 'object' && Object.keys(multerReq.files).length > 0);

  if (!hasFiles) {
    res.status(400).json({
      success: false,
      error: 'At least one product image is required'
    });
    return;
  }

  next();
};

// Middleware to validate product data fields
export const validateProductData = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requiredFields = ['productName', 'description', 'category'];
  const missingFields = [];

  for (const field of requiredFields) {
    if (!req.body[field] || req.body[field].trim() === '') {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    res.status(400).json({
      success: false,
      error: `Missing required fields: ${missingFields.join(', ')}`,
      missingFields
    });
    return;
  }

  // Validate field lengths
  const fieldLimits = {
    productName: 100,
    description: 2000,
    category: 50,
    brand: 50,
    model: 50,
    serialNumber: 100,
    batchNumber: 50,
    manufacturerName: 100,
    manufacturerAddress: 200,
    originCountry: 50,
    tags: 500
  };

  const invalidFields = [];
  for (const [field, maxLength] of Object.entries(fieldLimits)) {
    if (req.body[field] && req.body[field].length > maxLength) {
      invalidFields.push(`${field} (max ${maxLength} characters)`);
    }
  }

  if (invalidFields.length > 0) {
    res.status(400).json({
      success: false,
      error: `Field(s) exceed maximum length: ${invalidFields.join(', ')}`,
      invalidFields
    });
    return;
  }

  next();
};