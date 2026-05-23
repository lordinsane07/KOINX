import { ValidationError } from '../../infrastructure/errors.js';

/**
 * Express middleware factory to validate request body using a Joi schema.
 * Rejects with a ValidationError on failures, passing formatted error details.
 *
 * @param {import('joi').Schema} schema - Joi validation schema
 * @returns {import('express').RequestHandler} Express request handler middleware
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const details = {};
      for (const item of error.details) {
        // Map Joi validation path to error message
        const path = item.path.join('.');
        details[path] = item.message;
      }

      return next(new ValidationError('Request body validation failed', details));
    }

    // Replace req.body with casted/sanitized Joi value
    req.body = value;
    return next();
  };
}

export default validateBody;
