import { stat } from 'node:fs/promises';

import { config } from '../config.js';
import { ValidationError } from '../errors.js';

/**
 * Assert that a file does not exceed the configured maximum CSV size.
 *
 * Called before CSV parsing to short-circuit early — there is no point
 * streaming a 2 GB file into the parser only to OOM halfway through.
 *
 * @param {string} filePath - Absolute path to the file (already validated by filePath.guard)
 * @returns {Promise<number>} The file size in bytes (useful for progress tracking)
 * @throws {ValidationError} If the file does not exist, is not accessible, or exceeds the size limit
 */
export async function assertFileSize(filePath) {
  let fileStat;

  try {
    fileStat = await stat(filePath);
  } catch (err) {
    throw new ValidationError(`Cannot access file: ${filePath}`, {
      filePath,
      originalError: err.message,
    });
  }

  if (!fileStat.isFile()) {
    throw new ValidationError('Path does not point to a regular file', {
      filePath,
    });
  }

  const maxBytes = config.maxCsvFileBytes;

  if (fileStat.size > maxBytes) {
    throw new ValidationError(
      `File size (${fileStat.size} bytes) exceeds maximum allowed size (${maxBytes} bytes)`,
      {
        filePath,
        fileSize: fileStat.size,
        maxAllowed: maxBytes,
      },
    );
  }

  return fileStat.size;
}
