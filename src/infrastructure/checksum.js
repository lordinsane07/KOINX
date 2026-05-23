import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

import { IngestionError } from './errors.js';

/**
 * Compute a SHA-256 hex digest of a file using streaming I/O.
 * Used for deduplication: if two CSVs produce the same hash they are
 * byte-identical, so we can skip re-ingestion.
 *
 * @param {string} filePath - Absolute path to the file to hash
 * @returns {Promise<string>} Hex-encoded SHA-256 digest
 * @throws {IngestionError} If the file cannot be read
 */
export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));

    stream.on('end', () => resolve(hash.digest('hex')));

    stream.on('error', (err) => {
      reject(
        new IngestionError(`Failed to compute checksum for file: ${filePath}`, {
          filePath,
          originalError: err.message,
        }),
      );
    });
  });
}
