import { resolve, relative } from 'node:path';

import { config } from '../config.js';
import { ValidationError } from '../errors.js';
import { MAX_FILE_PATH_LENGTH } from '../constants.js';

/**
 * Resolve a user-supplied file path and verify it lives within the
 * allowed base directory (`config.allowedFileBaseDir`).
 *
 * This is the sole defence against path-traversal attacks — every endpoint
 * that accepts a file path MUST route through this guard before touching disk.
 *
 * Security invariants enforced:
 * 1. Path length cap (OS-level limit guard)
 * 2. The resolved absolute path starts with the allowed base dir
 * 3. No symlink-based escapes (resolve normalises `..` and `.`)
 *
 * @param {string} userPath - The raw file path supplied by the client
 * @returns {string} The resolved, validated absolute path
 * @throws {ValidationError} If the path is empty, too long, or escapes the allowed directory
 */
export function assertSafePath(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    throw new ValidationError('File path is required', { received: userPath });
  }

  if (userPath.length > MAX_FILE_PATH_LENGTH) {
    throw new ValidationError(
      `File path exceeds maximum length of ${MAX_FILE_PATH_LENGTH} characters`,
      { length: userPath.length, max: MAX_FILE_PATH_LENGTH },
    );
  }

  const baseDir = resolve(config.allowedFileBaseDir);
  const resolved = resolve(baseDir, userPath);

  // `relative()` produces a path that does NOT start with '..' when
  // `resolved` is inside `baseDir`. An exact match yields ''.
  const rel = relative(baseDir, resolved);
  const isOutside = rel.startsWith('..') || resolve(baseDir, rel) !== resolved;

  if (isOutside) {
    throw new ValidationError('File path escapes allowed directory', {
      // Intentionally omit the resolved path to avoid leaking server structure
      allowedBase: baseDir,
    });
  }

  return resolved;
}
