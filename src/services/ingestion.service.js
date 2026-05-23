import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { rawTransactionRepo } from '../repositories/rawTransaction.repo.js';
import { normalisedTransactionRepo } from '../repositories/normalisedTransaction.repo.js';
import { validateRow } from '../domain/validators/row.validator.js';
import { normaliseRow } from '../domain/normalisers/index.js';
import { IngestionError } from '../infrastructure/errors.js';
import { config } from '../infrastructure/config.js';
import { logger } from '../infrastructure/logger.js';

/**
 * Service for streaming CSV ingestion.
 * Handles parsing, validation, normalisation, and database persistence
 * of raw and normalised crypto transactions.
 */
export const ingestionService = {
  /**
   * Parse a CSV file, validate rows, normalise them, and insert into the database.
   * Leverages stream processing and chunked batch inserts for high performance and low memory footprint.
   *
   * @param {string} filePath - Absolute path to the CSV file
   * @param {'user' | 'exchange'} source - Source identifier
   * @param {string} runId - Reconciliation run identifier
   * @returns {Promise<{
   *   totalRows: number,
   *   validRows: number,
   *   invalidRows: number,
   *   flagBreakdown: Record<string, number>
   * }>}
   */
  async ingestFile(filePath, source, runId) {
    logger.info(`Starting ingestion for runId: ${runId}, source: ${source}, file: ${filePath}`);

    return new Promise((resolvePromise, rejectPromise) => {
      const rawRowsToInsert = [];
      const normalisedRowsToInsert = [];

      let rowIndex = 0;
      let validRows = 0;
      let invalidRows = 0;
      const flagBreakdown = {};

      const parser = parse({
        columns: (headers) => headers.map((h) => h.trim().toLowerCase()),
        bom: true,
        skip_empty_lines: true,
        trim: true,
      });

      const fileStream = createReadStream(filePath);

      fileStream.on('error', (err) => {
        logger.error(`File stream error reading file: ${filePath} - ${err.message}`);
        rejectPromise(new IngestionError(`Failed to read CSV file: ${err.message}`, { filePath, source }));
      });

      parser.on('error', (err) => {
        logger.error(`CSV parsing error for runId: ${runId}, source: ${source} - ${err.message}`);
        rejectPromise(new IngestionError(`CSV syntax error: ${err.message}`, { filePath, source }));
      });

      parser.on('readable', () => {
        let record;
        // eslint-disable-next-line no-cond-assign
        while ((record = parser.read()) !== null) {
          rowIndex++;

          // 1. Initial Validation (check presence of required columns)
          const validationResult = validateRow(record);

          if (!validationResult.isValid) {
            invalidRows++;
            // Increment breakdown counts
            for (const flag of validationResult.qualityFlags) {
              flagBreakdown[flag] = (flagBreakdown[flag] || 0) + 1;
            }

            rawRowsToInsert.push({
              runId,
              source,
              rawData: record,
              rowIndex,
              isValid: false,
              qualityFlags: validationResult.qualityFlags,
            });
            continue;
          }

          // 2. Normalisation (attempt to cast and normalise fields)
          const normaliseResult = normaliseRow(record, config.assetAliases, config.typeAliases);

          if (normaliseResult.flags.length > 0) {
            invalidRows++;
            for (const flag of normaliseResult.flags) {
              flagBreakdown[flag] = (flagBreakdown[flag] || 0) + 1;
            }

            rawRowsToInsert.push({
              runId,
              source,
              rawData: record,
              rowIndex,
              isValid: false,
              qualityFlags: normaliseResult.flags,
            });
          } else {
            validRows++;

            // Raw transaction is valid
            rawRowsToInsert.push({
              runId,
              source,
              rawData: record,
              rowIndex,
              isValid: true,
              qualityFlags: [],
            });

            // Normalised transaction is ready to be persisted
            normalisedRowsToInsert.push({
              runId,
              source,
              timestamp: normaliseResult.normalisedData.timestamp,
              asset: normaliseResult.normalisedData.asset,
              type: normaliseResult.normalisedData.type,
              quantity: normaliseResult.normalisedData.quantity,
              txHash: normaliseResult.normalisedData.txHash,
              exchangeId: normaliseResult.normalisedData.exchangeId,
              // We'll link the rawTransactionId after inserting raw transactions
            });
          }
        }
      });

      parser.on('end', async () => {
        try {
          logger.info(`Finished parsing CSV for runId: ${runId}, source: ${source}. Total rows parsed: ${rowIndex}`);

          // 3. Persist Raw Transactions
          const rawDocs = await rawTransactionRepo.bulkCreate(rawRowsToInsert);

          // Map raw Transaction ObjectIds to normalised transaction objects before inserting
          // Note: bulkCreate returns inserted documents, maintaining order
          let rawDocIndex = 0;
          const linkedNormalisedRows = [];

          for (let i = 0; i < rawRowsToInsert.length; i++) {
            const rawRow = rawRowsToInsert[i];
            const rawDoc = rawDocs[i];

            if (rawRow.isValid) {
              const normalisedRow = normalisedRowsToInsert[rawDocIndex++];
              normalisedRow.rawTransactionId = rawDoc._id;
              linkedNormalisedRows.push(normalisedRow);
            }
          }

          // 4. Persist Normalised Transactions
          await normalisedTransactionRepo.bulkCreate(linkedNormalisedRows);

          logger.info(`Successfully persisted database records for runId: ${runId}, source: ${source}`);
          resolvePromise({
            totalRows: rowIndex,
            validRows,
            invalidRows,
            flagBreakdown,
          });
        } catch (dbErr) {
          logger.error(`Database insertion failed during ingestion: ${dbErr.message}`, dbErr);
          rejectPromise(new IngestionError(`Database persistence failure: ${dbErr.message}`, { runId, source }));
        }
      });

      fileStream.pipe(parser);
    });
  },
};
