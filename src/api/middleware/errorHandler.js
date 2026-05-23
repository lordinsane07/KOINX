import { AppError } from '../../infrastructure/errors.js';
import { logger } from '../../infrastructure/logger.js';
import { config } from '../../infrastructure/config.js';

/**
 * Global Express error handling middleware.
 * Intercepts all unhandled route errors, formats them to the standard JSON error format,
 * logs detailed stacks, and hides internal details in production environment.
 *
 * Standard JSON format:
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Required field timestamp is missing",
 *     "details": { ... }
 *   }
 * }
 */
export function errorHandler(err, req, res, next) {
  // If headers already sent, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const errorCode = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError || config.nodeEnv !== 'production'
    ? err.message
    : 'An unexpected internal server error occurred.';
  const details = isAppError ? err.details : {};

  // Log error with appropriate level and context
  if (statusCode >= 500) {
    logger.error(`[Express Error] 5xx - ${req.method} ${req.url} - ${err.message}`, {
      stack: err.stack,
      requestBody: req.body,
    });
  } else {
    logger.warn(`[Express Error] 4xx - ${req.method} ${req.url} - ${err.message}`, {
      statusCode,
      code: errorCode,
      details,
    });
  }

  const errorResponse = {
    error: {
      code: errorCode,
      message,
    },
  };

  // Only include details if they contain data
  if (details && Object.keys(details).length > 0) {
    errorResponse.error.details = details;
  }

  // Include stack trace in non-production environments for debugging ease
  if (config.nodeEnv !== 'production' && statusCode >= 500) {
    errorResponse.error.stack = err.stack;
  }

  return res.status(statusCode).json(errorResponse);
}
export default errorHandler;
