import Joi from 'joi';

/**
 * Joi schema to validate POST /reconcile request payloads.
 * Strictly checks required file paths and validates any optional config overrides.
 */
export const reconcileSchema = Joi.object({
  userFilePath: Joi.string()
    .required()
    .min(1)
    .max(500)
    .messages({
      'any.required': 'userFilePath is a mandatory field.',
      'string.empty': 'userFilePath cannot be empty.',
    }),

  exchangeFilePath: Joi.string()
    .required()
    .min(1)
    .max(500)
    .messages({
      'any.required': 'exchangeFilePath is a mandatory field.',
      'string.empty': 'exchangeFilePath cannot be empty.',
    }),

  config: Joi.object({
    timestampToleranceSecs: Joi.number()
      .integer()
      .min(0)
      .max(86400) // limit to max 1 day window
      .description('Timestamp matching window in seconds'),

    quantityTolerancePct: Joi.number()
      .min(0)
      .max(1)
      .description('Decimal percentage matching window for quantities'),

    requireExactType: Joi.boolean()
      .description('If true, canonical transaction types must match exactly'),
  }).optional(),
});
export default reconcileSchema;
