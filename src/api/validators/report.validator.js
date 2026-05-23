import Joi from 'joi';
import { REPORT_LIMIT_MAX } from '../../infrastructure/constants.js';

/**
 * Joi schema to validate report query parameters (pagination + category filters).
 */
export const reportQuerySchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'page parameter must be a valid integer.',
      'number.min': 'page parameter must be at least 1.',
    }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(REPORT_LIMIT_MAX)
    .default(100)
    .messages({
      'number.base': 'limit parameter must be a valid integer.',
      'number.min': 'limit parameter must be at least 1.',
      'number.max': `limit parameter cannot exceed ${REPORT_LIMIT_MAX}.`,
    }),

  category: Joi.string()
    .valid('MATCHED', 'CONFLICTING', 'UNMATCHED_USER', 'UNMATCHED_EXCHANGE')
    .optional()
    .messages({
      'any.only': 'category filter must be one of: MATCHED, CONFLICTING, UNMATCHED_USER, UNMATCHED_EXCHANGE.',
    }),
});
export default reportQuerySchema;
