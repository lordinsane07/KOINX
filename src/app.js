import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { reconcileRouter } from './api/routes/reconcile.routes.js';
import { reportRouter } from './api/routes/report.routes.js';
import { requestLogger } from './api/middleware/requestLogger.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { config } from './infrastructure/config.js';

export const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
// Security headers (allowing font and script CDNs for the premium frontend)
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

// CORS enablement
app.use(cors());

// Body parser
app.use(express.json({ limit: '10mb' }));

// Serve static client frontend from public folder
app.use(express.static('src/public'));

// NoSQL injection protection
app.use(mongoSanitize());

// HTTP Request Logger
app.use(requestLogger);

// ─── Swagger Documentation ───────────────────────────────────────────────────
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'KoinX Crypto Transaction Reconciliation Engine API',
      version: '1.0.0',
      description: 'Production-grade Node.js service to ingest dual-source transaction exports, run configurable matching, and fetch structured reconciliation reports.',
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: 'Development Server',
      },
    ],
  },
  apis: ['./src/api/routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Core REST Routes ─────────────────────────────────────────────────────────
app.use('/reconcile', reconcileRouter);
app.use('/report', reportRouter);

// ─── Health Check ────────────────────────────────────────────────────────────
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Verify service health status
 *     description: Returns the status of the Node.js application, server environment, and active configuration attributes.
 *     responses:
 *       200:
 *         description: Service is healthy.
 */
app.use('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    environment: config.nodeEnv,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
