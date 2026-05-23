/**
 * Simple wrapper utility to catch exceptions in async Express route handlers
 * and forward them directly to the next() error handling middleware.
 * Prevents unhandled promise rejections that could crash the server.
 *
 * @param {Function} fn - Async Express request handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
