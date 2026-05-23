# KoinX Crypto Transaction Reconciliation Engine

A production-grade, high-performance, and secure **Crypto Transaction Reconciliation Engine** built in Node.js (ESM). It ingests dual-source transaction data (user tax records and exchange ledger exports), validates and normalizes records side-by-side, runs an $O(N \log N)$ 4-pass matching algorithm using binary search candidate windowing and Decimal arithmetic, and produces paginated JSON reports alongside structured side-by-side CSV files.

Equipped with a dual-mode background worker queue (BullMQ + Redis) that transparently falls back to local thread execution if Redis is offline, it is designed for zero-friction local testing while remaining fully scaled for clustered production deployments.

---

## 🏗️ Architectural Layering & Data Flow

The engine strictly follows a modular, five-tier architecture. Each tier is strictly decoupled, allowing independent testing and maintenance.

```
                  ┌────────────────────────────────────────┐
                  │               HTTP Client              │
                  └───────────────────┬────────────────────┘
                                      │ REST Requests (JSON / Streams)
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. API LAYER (Express.js Router & Middlewares)                           │
│    - Path Traversal Guard  - Rate Limiter       - Helmet Security Headers│
│    - File Size Guard       - Body Parser        - Express Async Handlers │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ Validated Ingest Payload
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. SERVICE LAYER (Orchestrators & Compilers)                             │
│    - Ingestion Service     - Matching Service   - Report Exporter        │
│    - Reconcile Service     - SHA-256 Idempotency Check                   │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ Dispatch Background Job
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. WORKER LAYER (Dual-Mode Job Queue)                                    │
│    - BullMQ Enqueue (Redis Active)  ──►  Background Worker Process       │
│    - Local Event-Loop Fallback (Redis Offline) ──► setImmediate Thread   │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ DB Persistence / Fetch Queries
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. REPOSITORY & DATA LAYER (Mongoose Schemas & Indexing)                  │
│    - RawTransaction Repository      - NormalisedTransaction Repository   │
│    - ReconciliationRun Repository   - ReportEntry Repository (Cursor)    │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ Process Lean & Pure Operations
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 5. PURE DOMAIN LAYER (Business & Math Rules — Zero I/O, Zero DB)         │
│    - Asset Converter       - Row Validator      - Exact ID Linker        │
│    - Date ISO Parser       - Decimal Normalizer - Proximity Matcher      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Production-Grade Features

1. **Clustered Background Job Queue (BullMQ + Redis):**
   * Uses **BullMQ** for robust, cluster-safe background job scheduling. CPU-heavy reconciliation runs are dispatched off the web server process to keep HTTP request paths immediate and lightweight.
   * **Dual-Mode Resiliency:** Detects Redis connectivity on boot. If Redis is active, it runs clustered. If Redis is offline, it automatically drops back to an event-loop `setImmediate` deferral, ensuring **zero-friction local evaluation**.
2. **Defensive Path-Traversal & File Safety Security Guards:**
   * **Path Guard:** Enforces strict boundary resolution. User-provided paths are fully resolved and forbidden from traversing outside the configured allowed directory (e.g., preventing `../../etc/passwd` injection).
   * **File Size Guard:** Checks file buffers and stream sizes before parsing to block Denial of Service (DoS) attacks.
3. **Advanced 4-Pass Matching Engine:**
   * **Pass 1 (Exact ID Link):** Greedily binds records featuring identical transaction hashes or exchange IDs.
   * **Pass 2 (Fuzzy Proximity Match):** Employs **binary search** to slice transaction arrays in $O(\log n)$ candidate windows, scoring results via a multi-dimensional linear decay algorithm based on time, quantity, type, and hash bonuses.
   * **Pass 3 (Conflict Detection):** Pinpoints matches whose parameters deviate beyond tolerances, flagging them as `CONFLICTING` and producing exact field deltas.
   * **Pass 4 (Remainder Assignment):** Classifies left-overs into their respective user/exchange unmatched buckets.
4. **Precision-Safe Arithmetic (Decimal.js):**
   * Eliminates standard binary float problems (e.g., `0.1 + 0.2 === 0.30000000000000004`) which cause matching anomalies in financial systems. All transaction volumes, differences, and scores are processed using `Decimal.js`.
5. **No Data Loss Policy:**
   * Malformed or unparseable rows are never silently discarded. They are ingested, marked `isValid: false`, flagged with specific quality codes, and listed in the unmatched reports to enable complete auditability.
6. **Graceful Shutdown Routines:**
   * Handlers for `SIGINT` and `SIGTERM` ensure that when the server terminates, the BullMQ worker, Redis connections, and Mongoose database threads are cleanly closed down, preventing lost jobs or orphaned handles.
7. **Idempotency Hashing:**
   * Computes SHA-256 stream fingerprints of inputs and configurations during initialization. Redundant duplicate requests return cached reconciliation summaries in milliseconds.

---

## ⚙️ Configuration Reference (`.env`)

Configure the engine globally via environment variables.

| Variable Name | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP server to bind to |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`) |
| `MONGODB_URI` | `mongodb://localhost:27017/koinx_reconciliation` | MongoDB connection URL (Atlas cluster or local) |
| `REDIS_HOST` | `localhost` | Redis server hostname for BullMQ queues |
| `REDIS_PORT` | `6379` | Redis server port |
| `WORKER_CONCURRENCY` | `3` | Parallel jobs a single background worker process can process |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Default fuzzy time-proximity window in seconds |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Default matching tolerance for quantities (e.g., 0.01 = 1%) |
| `REQUIRE_EXACT_TYPE` | `false` | If true, fuzzy matcher requires identical canonical type values |
| `ALLOWED_FILE_BASE_DIR` | `./data` | Directory containing allowed transaction CSVs (path traversal boundary) |
| `MAX_CSV_FILE_BYTES` | `104857600` | Maximum file size in bytes (100MB) |
| `REPORT_OUTPUT_DIR` | `./reports` | Target folder for side-by-side CSV exports |
| `LOG_DIR` | `./logs` | Target folder for rotating application log files |
| `LOG_LEVEL` | `info` | Minimum logging verbosity (`info`, `warn`, `error`, `debug`) |

---

## 🚀 Running the Project

### Option A: Clustered Docker Stack (Recommended)
This spins up a complete, production-grade cluster containing the **Express API App**, **MongoDB**, and **Redis** instantly. No local installations of databases or dependencies are required.

```bash
# 1. Boot up the entire pre-wired stack in the background
docker-compose up -d

# 2. Monitor active logs (Web Server and BullMQ Worker initialization)
docker-compose logs -f app
```
*The Express API and documentation are instantly running at `http://localhost:3000`.*

---

### Option B: Local Node.js Development Mode
If you prefer running Node.js directly on your local system:

**Prerequisites:**
* Node.js version **>= 20.0.0**
* MongoDB running locally (or MongoDB Atlas)
* Redis running locally (optional; if offline, the engine falls back to local async threads automatically)

```bash
# 1. Install project dependencies
npm install

# 2. Configure environment variables (copy template)
cp .env.example .env

# 3. Create indices on MongoDB database
npm run verify:indexes

# 4. Boot up development HMR server (Nodemon + local worker)
npm run dev
```

---

### Option C: Strict Production-Grade Deployment (Bare Metal / VM)
To deploy this system to a production environment exactly:

1. **Provision Infrastructure:** Spin up your production MongoDB database (e.g., Atlas Cluster) and Redis server.
2. **Environment Configuration:** Inject your configuration variables. At a minimum, set:
   ```env
   NODE_ENV=production
   PORT=80
   MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/reconciliation
   REDIS_HOST=10.0.0.5
   REDIS_PORT=6379
   ALLOWED_FILE_BASE_DIR=/var/secure/reconciliation/uploads
   REPORT_OUTPUT_DIR=/var/secure/reconciliation/reports
   LOG_DIR=/var/log/reconciliation
   LOG_LEVEL=warn
   ```
3. **Establish Storage Directories:** Ensure the directories for uploads, reports, and logs are established and writeable:
   ```bash
   mkdir -p /var/secure/reconciliation/uploads /var/secure/reconciliation/reports /var/log/reconciliation
   ```
4. **Bootstrap Application:**
   * **Single Server Mode:** Run `npm start` which boots the Express web server and the BullMQ worker together inside the same Node event loop:
     ```bash
     npm start
     ```
   * **Clustered Microservices Mode (Recommended):** Scale your API server and workers independently using PM2 or individual Docker containers:
     ```bash
     # Start the stateless Express API Web Server (Scale as needed)
     pm2 start server.js --name "reconcile-api" --node-args="--experimental-vm-modules"
     
     # Start separate background worker instances to execute matching queues
     pm2 start src/workers/reconcile.worker.js --name "reconcile-worker" -i max
     ```

---

## 🧪 Testing & Verification

A comprehensive, isolated testing environment is provided. Integration tests run against an in-memory database server, completely isolated from your local databases.

```bash
# 1. Run all unit and integration tests (34 assertions — 100% quiet and green)
npm run test

# 2. Run unit tests only
npm run test:unit

# 3. Run integration tests only
npm run test:int

# 4. Generate coverage reports
npm run test:coverage

# 5. Run ESLint checks (strict Airbnb conventions — 0 errors, 0 warnings)
npm run lint
```

---

## 🔌 API Endpoints Reference

### 1. Health Status (`GET /health`)
Returns the environment details, database statuses, system uptime, and memory footprints.
```bash
curl http://localhost:3000/health
```

### 2. Trigger Reconciliation (`POST /reconcile`)
Launches the dual-source ingestion and matching pipeline. Files are read from `ALLOWED_FILE_BASE_DIR`.
* **Request Body:**
  ```json
  {
    "userFilePath": "user_transactions.csv",
    "exchangeFilePath": "exchange_transactions.csv",
    "config": {
      "timestampToleranceSecs": 300,
      "quantityTolerancePct": 0.01,
      "requireExactType": false
    }
  }
  ```
* **Command:**
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"userFilePath": "user_transactions.csv", "exchangeFilePath": "exchange_transactions.csv"}' \
    http://localhost:3000/reconcile
  ```
* **Response (202 Accepted):**
  ```json
  {
    "runId": "31ec3781-fcb4-4848-be0d-3f568a5aa3c4",
    "status": "PENDING",
    "triggeredAt": "2026-05-23T18:15:30.728Z"
  }
  ```

### 3. Fetch Aggregate Summary (`GET /report/:runId/summary`)
Returns matched/conflicting/unmatched counts, checksums, and configuration metadata.
```bash
curl http://localhost:3000/report/31ec3781-fcb4-4848-be0d-3f568a5aa3c4/summary
```

### 4. Fetch Full Paginated Report (`GET /report/:runId`)
Returns paginated listing of all report entries.
* **Query Params:** `page` (default 1), `limit` (default 100), `category` (optional filter: `MATCHED`, `CONFLICTING`, `UNMATCHED_USER`, `UNMATCHED_EXCHANGE`)
```bash
curl "http://localhost:3000/report/31ec3781-fcb4-4848-be0d-3f568a5aa3c4?page=1&limit=5"
```

### 5. Fetch Unmatched Rows (`GET /report/:runId/unmatched`)
Returns paginated unmatched entries along with structural quality flags or matching failure reasons.
```bash
curl http://localhost:3000/report/31ec3781-fcb4-4848-be0d-3f568a5aa3c4/unmatched
```

### 6. Side-by-Side CSV Export Download (`GET /report/:runId/download`)
Compiles user and exchange matching records side-by-side on unified rows. Downloads as a standard, auditor-ready CSV file.
```bash
curl -o reconciliation_report.csv http://localhost:3000/report/31ec3781-fcb4-4848-be0d-3f568a5aa3c4/download
```

---

## 🛠️ Data Quality Code Reference

When transaction rows contain structural issues, they are saved under the unmatched categories and labeled with the following granular codes:

| Flag | Meaning |
| :--- | :--- |
| `MISSING_FIELD` | A required field (timestamp, asset, type, or quantity) is missing or blank |
| `INVALID_TIMESTAMP` | The cell timestamp is unparseable under standard ISO 8601 or regional formats |
| `FUTURE_TIMESTAMP` | The transaction date resides in the future (exceeding clock drift tolerance buffer) |
| `INVALID_QUANTITY` | The volume volume is zero, negative, or mathematically non-finite |
| `QUANTITY_OVERFLOW` | The transaction volume exceeds the safety cap limit ($10^{15}$) |
| `UNKNOWN_ASSET` | The ticker is unresolvable under standard alias maps (e.g., BTC, ETH) |
| `UNKNOWN_TYPE` | The action type is unresolvable under canonical type mappings |
