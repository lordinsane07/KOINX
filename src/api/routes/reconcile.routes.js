import { Router } from 'express';
import { reconcileService } from '../../services/reconcile.service.js';
import { validateBody } from '../middleware/validateBody.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { reconcileSchema } from '../validators/reconcile.validator.js';
import { assertSafePath } from '../../infrastructure/security/filePath.guard.js';
import { assertFileSize } from '../../infrastructure/security/fileSize.guard.js';
import { logger } from '../../infrastructure/logger.js';
import { RUN_STATUS } from '../../infrastructure/constants.js';
import { dispatchReconcileJob } from '../../infrastructure/queue.js';

export const reconcileRouter = Router();

/**
 * @swagger
 * /reconcile:
 *   post:
 *     summary: Trigger a transaction reconciliation run
 *     description: Ingests the two CSV files, validates and normalises rows, and runs the 4-pass matching algorithm in the background. Enforces path traversal protection and file size limits.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userFilePath
 *               - exchangeFilePath
 *             properties:
 *               userFilePath:
 *                 type: string
 *                 description: Relative path to the user transaction CSV from the allowed base directory.
 *                 example: "exchange_transactions.csv"
 *               exchangeFilePath:
 *                 type: string
 *                 description: Relative path to the exchange transaction CSV from the allowed base directory.
 *                 example: "exchange_transactions.csv"
 *               config:
 *                 type: object
 *                 properties:
 *                   timestampToleranceSecs:
 *                     type: integer
 *                     default: 300
 *                   quantityTolerancePct:
 *                     type: number
 *                     default: 0.01
 *                   requireExactType:
 *                     type: boolean
 *                     default: false
 *     responses:
 *       202:
 *         description: Reconciliation run initialised and processing in the background (or returned existing run due to idempotency).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 runId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [PENDING, RUNNING, COMPLETE, PARTIAL]
 *                 triggeredAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request payload, path traversal escape, or file too large.
 *       500:
 *         description: Internal server error.
 */
reconcileRouter.post(
  '/',
  validateBody(reconcileSchema),
  asyncHandler(async (req, res) => {
    const { userFilePath, exchangeFilePath, config } = req.body;

    logger.info(`Received POST /reconcile for user: ${userFilePath}, exchange: ${exchangeFilePath}`);

    // 1. Enforce Path Traversal Protection
    const safeUserPath = assertSafePath(userFilePath);
    const safeExchangePath = assertSafePath(exchangeFilePath);

    // 2. Enforce File Size Guards
    await assertFileSize(safeUserPath);
    await assertFileSize(safeExchangePath);

    // 3. Initialise Reconciliation Run (Dedup check / Mongoose insert)
    const run = await reconcileService.initRun(safeUserPath, safeExchangePath, config);

    // 4. Trigger background processing if new PENDING run
    if (run.status === RUN_STATUS.PENDING) {
      logger.info(`Spawning background job dispatcher for run: ${run.runId}`);
      // Dispatch the job using our production-ready queue mechanism
      await dispatchReconcileJob(
        run.runId,
        safeUserPath,
        safeExchangePath,
        reconcileService.executeRun.bind(reconcileService),
      );

      return res.status(202).json({
        runId: run.runId,
        status: run.status,
        triggeredAt: run.triggeredAt,
      });
    }

    // If run already exists and is COMPLETE, return completed status immediately (idempotent)
    logger.info(`Run already exists with terminal status: ${run.status} for runId: ${run.runId}`);
    return res.status(200).json({
      runId: run.runId,
      status: run.status,
      triggeredAt: run.triggeredAt,
      completedAt: run.completedAt,
      summary: run.summary,
    });
  }),
);

export default reconcileRouter;
