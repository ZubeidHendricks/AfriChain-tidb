import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export interface ValidationRequest extends Request {
  validatedData?: any;
}

/**
 * Middleware factory to validate request data against a Joi schema
 * @param schema - Joi validation schema
 * @param property - Which part of the request to validate ('body', 'query', 'params')
 */
export const validateRequest = (
  schema: Joi.ObjectSchema,
  property: 'body' | 'query' | 'params' = 'body'
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type
      }));

      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errorDetails
      });
      return;
    }

    // Store validated data for use in route handlers
    (req as ValidationRequest).validatedData = value;
    
    // Replace the property with validated and sanitized data
    req[property] = value;

    next();
  };
};

/**
 * Common validation schemas for reuse across different routes
 */
export const commonSchemas = {
  phoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.pattern.base': 'Phone number must be in international format (e.g., +1234567890)',
      'any.required': 'Phone number is required'
    }),

  otp: Joi.string()
    .length(6)
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      'string.length': 'OTP must be exactly 6 digits',
      'string.pattern.base': 'OTP must contain only digits',
      'any.required': 'OTP is required'
    }),

  uuid: Joi.string()
    .uuid()
    .required()
    .messages({
      'string.uuid': 'Must be a valid UUID',
      'any.required': 'ID is required'
    }),

  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10)
  }),

  deviceInfo: Joi.object({
    deviceId: Joi.string().max(100).required(),
    platform: Joi.string().valid('ios', 'android', 'web').required(),
    appVersion: Joi.string().max(20).required(),
    pushToken: Joi.string().max(500).optional()
  })
};

/**
 * Middleware to validate pagination query parameters
 */
export const validatePagination = validateRequest(commonSchemas.pagination, 'query');

/**
 * Middleware to validate UUID parameters
 */
export const validateUuidParam = (paramName: string = 'id') => {
  const schema = Joi.object({
    [paramName]: commonSchemas.uuid
  });
  return validateRequest(schema, 'params');
};

/**
 * Sanitize and validate file upload data
 */
export const sanitizeFileUpload = (req: Request, res: Response, next: NextFunction): void => {
  // Remove any potentially dangerous file types
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
  ];

  const files = req.files;
  if (files) {
    let hasInvalidFile = false;

    if (Array.isArray(files)) {
      // Handle array of files
      for (const file of files) {
        if (!allowedMimeTypes.includes(file.mimetype)) {
          hasInvalidFile = true;
          break;
        }
      }
    } else if (typeof files === 'object') {
      // Handle files object with fieldnames
      for (const fieldname in files) {
        const fileArray = files[fieldname];
        if (Array.isArray(fileArray)) {
          for (const file of fileArray) {
            if (!allowedMimeTypes.includes(file.mimetype)) {
              hasInvalidFile = true;
              break;
            }
          }
        }
        if (hasInvalidFile) break;
      }
    }

    if (hasInvalidFile) {
      res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, WebP and GIF images are allowed.'
      });
      return;
    }
  }

  next();
};

export default validateRequest;