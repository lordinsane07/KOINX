import { logger } from '../../infrastructure/logger.js';

/**
 * Express middleware to log incoming HTTP requests.
 * Records HTTP method, target URL, response status code, and execution duration in milliseconds.
 * Uses winston to structure logging context.
 */
export function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Listen for the response finish event to compute elapsed time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;

    const logMsg = `${method} ${originalUrl} ${statusCode} - ${duration}ms`;

    const meta = {
      ip,
      method,
      url: originalUrl,
      statusCode,
      durationMs: duration,
    };

    if (statusCode >= 500) {
      logger.error(logMsg, meta);
    } else if (statusCode >= 400) {
      logger.warn(logMsg, meta);
    } else {
      logger.info(logMsg, meta);
    }
  });

  next();
}

export default requestLogger;
