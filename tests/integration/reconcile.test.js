import request from 'supertest';
import { connectMemoryDb, closeMemoryDb, clearMemoryDb } from '../helpers/setup.js';
// eslint-disable-next-line import/no-named-as-default
import app from '../../src/app.js';
import { reconcileService } from '../../src/services/reconcile.service.js';
import { assertSafePath } from '../../src/infrastructure/security/filePath.guard.js';

describe('Reconciliation Engine — End-to-End API Integration Tests', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  });

  afterAll(async () => {
    await closeMemoryDb();
  });

  beforeEach(async () => {
    await clearMemoryDb();
  });

  test('POST /reconcile -> Trigger run & GET /report/:runId/summary -> Retrieve complete report', async () => {
    // 1. Trigger the reconciliation run via POST
    // We point to the actual exchange_transactions.csv and user_transactions.csv in our workspace
    const payload = {
      userFilePath: 'user_transactions.csv',
      exchangeFilePath: 'exchange_transactions.csv',
      config: {
        timestampToleranceSecs: 300,
        quantityTolerancePct: 0.01,
        requireExactType: false,
      },
    };

    const postRes = await request(app)
      .post('/reconcile')
      .send(payload);

    expect(postRes.statusCode).toBe(202);
    expect(postRes.body).toHaveProperty('runId');
    expect(postRes.body.status).toBe('PENDING');

    const { runId } = postRes.body;

    // 2. To avoid timing issues in tests, execute the background runner synchronously in our test context
    const safeUserPath = assertSafePath(payload.userFilePath);
    const safeExchangePath = assertSafePath(payload.exchangeFilePath);
    await reconcileService.executeRun(runId, safeUserPath, safeExchangePath);

    // 3. GET /report/:runId/summary — fetch summary and counts
    const summaryRes = await request(app)
      .get(`/report/${runId}/summary`);

    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.body.runId).toBe(runId);
    expect(summaryRes.body.status).toBe('COMPLETE');
    expect(summaryRes.body.summary).toHaveProperty('matched');
    expect(summaryRes.body.summary).toHaveProperty('conflicting');
    expect(summaryRes.body.summary).toHaveProperty('unmatchedUser');
    expect(summaryRes.body.summary).toHaveProperty('unmatchedExchange');
    expect(summaryRes.body.summary.totalUserRows).toBe(25); // 25 rows in user_transactions.csv
    expect(summaryRes.body.summary.totalExchangeRows).toBe(25); // 25 rows in exchange_transactions.csv

    // 4. GET /report/:runId — fetch full report with pagination metadata
    const reportRes = await request(app)
      .get(`/report/${runId}?page=1&limit=5`);

    expect(reportRes.statusCode).toBe(200);
    expect(reportRes.body.run.runId).toBe(runId);
    expect(reportRes.body.data.length).toBeLessThanOrEqual(5);
    expect(reportRes.body.pagination.page).toBe(1);
    expect(reportRes.body.pagination.total).toBeGreaterThan(0);

    // 5. GET /report/:runId/unmatched — fetch only unmatched entries
    const unmatchedRes = await request(app)
      .get(`/report/${runId}/unmatched?page=1&limit=5`);

    expect(unmatchedRes.statusCode).toBe(200);
    expect(unmatchedRes.body.data.length).toBeGreaterThan(0);
    for (const item of unmatchedRes.body.data) {
      expect(['UNMATCHED_USER', 'UNMATCHED_EXCHANGE']).toContain(item.category);
    }

    // 6. GET /report/:runId/download — verify side-by-side CSV download
    const downloadRes = await request(app)
      .get(`/report/${runId}/download`);

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('text/csv');
    expect(downloadRes.text).toContain('Category,Reason,Match Score');
  });

  test('POST /reconcile -> Return 400 Bad Request on path traversal security escape', async () => {
    const maliciousPayload = {
      userFilePath: '../../../../etc/passwd',
      exchangeFilePath: 'exchange_transactions.csv',
    };

    const res = await request(app)
      .post('/reconcile')
      .send(maliciousPayload);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('File path escapes allowed directory');
  });

  test('GET /report/invalid-uuid/summary -> Return 404 Not Found', async () => {
    const res = await request(app)
      .get('/report/00000000-0000-0000-0000-000000000000/summary');

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
