import Decimal from 'decimal.js';
import { exactIdMatch } from '../domain/matchers/exactId.matcher.js';
import { fuzzyProximityMatch } from '../domain/matchers/fuzzyProximity.matcher.js';
import { rawTransactionRepo } from '../repositories/rawTransaction.repo.js';
import { normalisedTransactionRepo } from '../repositories/normalisedTransaction.repo.js';
import { reportEntryRepo } from '../repositories/reportEntry.repo.js';
import { REPORT_CATEGORIES } from '../infrastructure/constants.js';
import { logger } from '../infrastructure/logger.js';

/**
 * Service to execute the 4-pass transaction matching engine.
 * Computes scores, evaluates tolerances, detects conflicts,
 * and compiles the final reconciliation report.
 */
export const matchingService = {
  /**
   * Run the matching algorithm on ingested data for a given run.
   *
   * @param {string} runId - Reconciliation run ID
   * @param {object} runConfig - Configuration parameters containing tolerances
   * @returns {Promise<{
   *   matched: number,
   *   conflicting: number,
   *   unmatchedUser: number,
   *   unmatchedExchange: number
   * }>}
   */
  async runMatching(runId, runConfig) {
    logger.info(`Starting matching engine for runId: ${runId}`);

    const { timestampToleranceSecs, quantityTolerancePct, requireExactType } = runConfig;

    // 1. Retrieve all normalised transactions for the run
    const rawUserNormalised = await normalisedTransactionRepo.findByRunAndSource(runId, 'user');
    const rawExchangeNormalised = await normalisedTransactionRepo.findByRunAndSource(runId, 'exchange');

    const userNormalised = rawUserNormalised.map((rec) => ({
      ...rec,
      quantity: rec.quantity ? new Decimal(rec.quantity.toString()) : null,
    }));
    const exchangeNormalised = rawExchangeNormalised.map((rec) => ({
      ...rec,
      quantity: rec.quantity ? new Decimal(rec.quantity.toString()) : null,
    }));

    logger.info(`Retrieved normalised transactions - User: ${userNormalised.length}, Exchange: ${exchangeNormalised.length}`);

    // Retrieve all raw transactions for mapping to original CSV rawData
    const userRaw = await rawTransactionRepo.findByRunAndSource(runId, 'user');
    const exchangeRaw = await rawTransactionRepo.findByRunAndSource(runId, 'exchange');

    // Build Maps of rawTransactionId -> rawData for instant lookup
    const rawDataMap = new Map();
    for (const r of userRaw) rawDataMap.set(r._id.toString(), r.rawData);
    for (const r of exchangeRaw) rawDataMap.set(r._id.toString(), r.rawData);

    // 2. Pass 1: Exact ID Matching
    const { exactMatches, userRemainder, exchangeRemainder } = exactIdMatch(userNormalised, exchangeNormalised);
    logger.info(`Pass 1 completed. Found ${exactMatches.length} exact ID matches. User remainder: ${userRemainder.length}, Exchange remainder: ${exchangeRemainder.length}`);

    const reportEntries = [];
    let matchedCount = 0;
    let conflictingCount = 0;

    // 3. Process exact ID matches — evaluate key fields to check for CONFLICTS
    for (const match of exactMatches) {
      const { user, exchange } = match;

      const userRawData = rawDataMap.get(user.rawTransactionId.toString());
      const exchangeRawData = rawDataMap.get(exchange.rawTransactionId.toString());

      // Quantities
      const userQty = new Decimal(user.quantity.toString());
      const exchangeQty = new Decimal(exchange.quantity.toString());

      // Compute deltas
      const deltaSeconds = Math.abs(user.timestamp.getTime() - exchange.timestamp.getTime()) / 1000;
      const deltaPct = exchangeQty.isZero()
        ? new Decimal(Infinity)
        : userQty.minus(exchangeQty).abs().dividedBy(exchangeQty);

      const timestampConflict = deltaSeconds > timestampToleranceSecs;
      const quantityConflict = deltaPct.greaterThan(new Decimal(quantityTolerancePct));
      const assetConflict = user.asset !== exchange.asset;
      const typeConflict = user.type !== exchange.type;

      const hasConflict = timestampConflict || quantityConflict || assetConflict || typeConflict;

      if (hasConflict) {
        conflictingCount++;
        const conflictDetails = [];

        if (timestampConflict) {
          conflictDetails.push({
            field: 'timestamp',
            userValue: user.timestamp.toISOString(),
            exchangeValue: exchange.timestamp.toISOString(),
            delta: `${deltaSeconds}s (tolerance: ${timestampToleranceSecs}s)`,
          });
        }
        if (quantityConflict) {
          conflictDetails.push({
            field: 'quantity',
            userValue: userQty.toString(),
            exchangeValue: exchangeQty.toString(),
            delta: `${deltaPct.times(100).toFixed(4)}% (tolerance: ${(quantityTolerancePct * 100).toFixed(4)}%)`,
          });
        }
        if (assetConflict) {
          conflictDetails.push({
            field: 'asset',
            userValue: user.asset,
            exchangeValue: exchange.asset,
            delta: 'Asset mismatch',
          });
        }
        if (typeConflict) {
          conflictDetails.push({
            field: 'type',
            userValue: user.type,
            exchangeValue: exchange.type,
            delta: 'Type mismatch',
          });
        }

        reportEntries.push({
          runId,
          category: REPORT_CATEGORIES.CONFLICTING,
          userRecord: userRawData,
          exchangeRecord: exchangeRawData,
          reason: 'Matched by transaction ID/hash, but key fields differ beyond tolerance.',
          conflictDetails,
        });
      } else {
        matchedCount++;
        reportEntries.push({
          runId,
          category: REPORT_CATEGORIES.MATCHED,
          userRecord: userRawData,
          exchangeRecord: exchangeRawData,
          matchScore: 100, // Perfect ID match within tolerance gets a default score of 100
          reason: 'Matched exactly by transaction ID/hash within tolerances.',
          conflictDetails: [],
        });
      }
    }

    // 4. Pass 2: Fuzzy Proximity Matching on remainders
    const {
      fuzzyMatches,
      userRemainder: finalUserRemainder,
      exchangeRemainder: finalExchangeRemainder,
    } = fuzzyProximityMatch(
      userRemainder,
      exchangeRemainder,
      {
        timestampToleranceSecs,
        quantityTolerancePct,
        requireExactType,
      },
    );

    logger.info(`Pass 2 completed. Found ${fuzzyMatches.length} fuzzy proximity matches. Final User remainder: ${finalUserRemainder.length}, Final Exchange remainder: ${finalExchangeRemainder.length}`);

    // Process fuzzy matches
    for (const match of fuzzyMatches) {
      const { user, exchange, score } = match;

      const userRawData = rawDataMap.get(user.rawTransactionId.toString());
      const exchangeRawData = rawDataMap.get(exchange.rawTransactionId.toString());

      matchedCount++;
      reportEntries.push({
        runId,
        category: REPORT_CATEGORIES.MATCHED,
        userRecord: userRawData,
        exchangeRecord: exchangeRawData,
        matchScore: score,
        reason: `Matched by timestamp proximity and quantity similarity (Score: ${score}).`,
        conflictDetails: [],
      });
    }

    // 5. Pass 4: Remainders to UNMATCHED
    let unmatchedUserCount = 0;
    let unmatchedExchangeCount = 0;

    // Process unmatched user records (valid rows that didn't match)
    for (const user of finalUserRemainder) {
      const userRawData = rawDataMap.get(user.rawTransactionId.toString());
      unmatchedUserCount++;
      reportEntries.push({
        runId,
        category: REPORT_CATEGORIES.UNMATCHED_USER,
        userRecord: userRawData,
        exchangeRecord: null,
        reason: 'No matching exchange transaction found within tolerances.',
        conflictDetails: [],
      });
    }

    // Process unmatched exchange records (valid rows that didn't match)
    for (const exchange of finalExchangeRemainder) {
      const exchangeRawData = rawDataMap.get(exchange.rawTransactionId.toString());
      unmatchedExchangeCount++;
      reportEntries.push({
        runId,
        category: REPORT_CATEGORIES.UNMATCHED_EXCHANGE,
        userRecord: null,
        exchangeRecord: exchangeRawData,
        reason: 'No matching user transaction found within tolerances.',
        conflictDetails: [],
      });
    }

    // 6. Ingest Invalid CSV rows into report as UNMATCHED with reasons
    const invalidRaw = await rawTransactionRepo.findInvalidByRun(runId);
    logger.info(`Retrieved ${invalidRaw.length} invalid raw transactions for runId: ${runId}`);

    for (const rawRecord of invalidRaw) {
      const issuesReason = `Row had data quality issues: ${rawRecord.qualityFlags.join(', ')}`;
      if (rawRecord.source === 'user') {
        unmatchedUserCount++;
        reportEntries.push({
          runId,
          category: REPORT_CATEGORIES.UNMATCHED_USER,
          userRecord: rawRecord.rawData,
          exchangeRecord: null,
          reason: issuesReason,
          conflictDetails: [],
        });
      } else {
        unmatchedExchangeCount++;
        reportEntries.push({
          runId,
          category: REPORT_CATEGORIES.UNMATCHED_EXCHANGE,
          userRecord: null,
          exchangeRecord: rawRecord.rawData,
          reason: issuesReason,
          conflictDetails: [],
        });
      }
    }

    // 7. Bulk save all report entries in database
    logger.info(`Persisting ${reportEntries.length} report entries for runId: ${runId}`);
    await reportEntryRepo.bulkCreate(reportEntries);

    logger.info(`Matching engine finished successfully for runId: ${runId}`);
    return {
      matched: matchedCount,
      conflicting: conflictingCount,
      unmatchedUser: unmatchedUserCount,
      unmatchedExchange: unmatchedExchangeCount,
    };
  },
};
