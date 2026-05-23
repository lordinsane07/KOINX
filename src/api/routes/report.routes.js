import { Router } from 'express';
import { reportService } from '../../services/report.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { reportQuerySchema } from '../validators/report.validator.js';
import { ValidationError } from '../../infrastructure/errors.js';
import { logger } from '../../infrastructure/logger.js';

export const reportRouter = Router();

/**
 * Helper to validate request query parameters against the Joi report query schema.
 *
 * @param {object} query - Express req.query object
 * @returns {object} Casted and validated query object
 * @throws {ValidationError}
 */
function validateQuery(query) {
  const { error, value } = reportQuerySchema.validate(query, {
    abortEarly: false,
    allowUnknown: false,
  });

  if (error) {
    const details = {};
    for (const item of error.details) {
      details[item.path.join('.')] = item.message;
    }
    throw new ValidationError('Invalid report query parameters', details);
  }

  return value;
}

/**
 * @swagger
 * /report/{runId}:
 *   get:
 *     summary: Fetch the full paginated reconciliation report
 *     description: Returns the run status, summary metadata, and paginated report entries (MATCHED, CONFLICTING, UNMATCHED).
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [MATCHED, CONFLICTING, UNMATCHED_USER, UNMATCHED_EXCHANGE]
 *     responses:
 *       200:
 *         description: Full report data retrieved successfully.
 *       404:
 *         description: Run not found.
 */
reportRouter.get(
  '/:runId',
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const cleanQuery = validateQuery(req.query);

    logger.info(`GET /report/${runId} with query: ${JSON.stringify(cleanQuery)}`);

    const result = await reportService.getFullReport(runId, cleanQuery);
    return res.status(200).json(result);
  }),
);

/**
 * @swagger
 * /report/{runId}/summary:
 *   get:
 *     summary: Fetch aggregate summary counts only
 *     description: Returns counts for matched, conflicting, unmatched entries, quality summaries, and processing duration.
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Summary retrieved successfully.
 *       404:
 *         description: Run not found.
 */
reportRouter.get(
  '/:runId/summary',
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    logger.info(`GET /report/${runId}/summary`);

    const result = await reportService.getSummary(runId);
    return res.status(200).json(result);
  }),
);

/**
 * @swagger
 * /report/{runId}/unmatched:
 *   get:
 *     summary: Fetch only unmatched records
 *     description: Returns a paginated list of UNMATCHED_USER and UNMATCHED_EXCHANGE entries with descriptive quality/matching failure reasons.
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Unmatched entries retrieved successfully.
 *       404:
 *         description: Run not found.
 */
reportRouter.get(
  '/:runId/unmatched',
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const cleanQuery = validateQuery(req.query);

    logger.info(`GET /report/${runId}/unmatched with query: ${JSON.stringify(cleanQuery)}`);

    const result = await reportService.getUnmatched(runId, cleanQuery);
    return res.status(200).json(result);
  }),
);

/**
 * @swagger
 * /report/{runId}/download:
 *   get:
 *     summary: Download report in CSV format
 *     description: Triggers generation of the side-by-side CSV report containing original user/exchange records, match scores, and categories, then downloads the file.
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: CSV report generated and downloaded successfully.
 *       404:
 *         description: Run not found.
 */
reportRouter.get(
  '/:runId/download',
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    logger.info(`GET /report/${runId}/download`);

    const csvPath = await reportService.generateCsv(runId);
    return res.download(csvPath, `reconciliation-report-${runId}.csv`);
  }),
);

export default reportRouter;
