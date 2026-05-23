# KoinX Transaction Reconciliation Engine

A production-grade, highly performant, and secure **Transaction Reconciliation Engine** built in Node.js (ESM). It ingests dual-source crypto transaction data (user exports and exchange exports), validates and normalises records side-by-side, runs a high-performance 4-pass matching algorithm using binary candidate windows and Decimal arithmetic, and produces paginated JSON reports and structured side-by-side CSV files.

---

## Key Features

1. **Robust Ingestion Pipeline:** Streaming CSV parser utilizing standard Node.js pipelines. Features early size boundary validation (file size guard) and NoSQL injection protection.
2. **Zero Silent Data Loss Policy:** Messy, malformed, or invalid rows are never silently dropped; they are captured immediately, marked `isValid: false`, flagged with granular data quality error codes, and listed in the final report's unmatched categories with their reasons.
3. **Advanced 4-Pass Matching Engine:**
   - **Pass 1 (Exact ID Match):** Greedily links transactions with identical `txHash` or `exchangeId` values.
   - **Pass 2 (Fuzzy Proximity Match):** Employs **binary search** to find candidate records in $O(\log n + w)$ time, filtering by asset alias maps and scoring via a multi-dimensional linear decay algorithm.
   - **Pass 3 (Conflict Detection):** Identifies exact-ID matches whose timestamps, quantities, types, or assets differ beyond tolerances, classifying them as `CONFLICTING` and calculating exact field deltas.
   - **Pass 4 (Remainder Assignment):** Leftover entries are pushed to their respective unmatched buckets.
4. **Idempotency Guard:** MD5/SHA-256 fingerprint hashing of input files and configurations ensures duplicate submissions return cached results instantly.
5. **Obsolescence & Rate Limiting:** Equipped with rate limiters, global Express error formatters, and Winston JSON-formatted rotating logs.

---

## Architectural Layering

```
┌─────────────────────────────────────────────────────────┐
│                        API Layer                        │
│         Express.js routes · Joi schema validation       │
├─────────────────────────────────────────────────────────┤
│                      Service Layer                      │
│      Ingestion service · Matching service · Reporter    │
├─────────────────────────────────────────────────────────┤
│                    Repository Layer                     │
│          Mongoose Models (Raw, Normalised, Run, Entry)   │
├─────────────────────────────────────────────────────────┤
│                      Domain Layer                       │
│     Pure functions: matchers · normalisers · validators │
│                    (zero I/O)                           │
├─────────────────────────────────────────────────────────┤
│                    Infrastructure                       │
│         DB connection · logger · config · security      │
└─────────────────────────────────────────────────────────┘
```

---

## Configuration Reference (`.env`)

Tolerances and environments can be set globally using environment variables or overridden dynamically on a per-request basis.

| Variable Name | Default Value | Description |
|---|---|---|
| `PORT` | `3000` | Port for the HTTP server |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`) |
| `MONGODB_URI` | `mongodb://localhost:27017/koinx_reconciliation` | MongoDB connection URL |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Default fuzzy matching window in seconds |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Default matching tolerance for quantities (e.g., 0.01 = 1%) |
| `REQUIRE_EXACT_TYPE` | `false` | If true, fuzzy matcher requires identical canonical types |
| `ALLOWED_FILE_BASE_DIR` | `./data` | Directory containing allowed transaction CSVs (path traversal boundary) |
| `MAX_CSV_FILE_BYTES` | `104857600` | Maximum file size in bytes (100MB) |
| `REPORT_OUTPUT_DIR` | `./reports` | Target folder for side-by-side CSV exports |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## Setup & Running Locally

### Prerequisites
- Node.js version **>= 20.0.0**
- MongoDB instance running locally (or connection string to Atlas)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and set your MongoDB URI:
```bash
cp .env.example .env
```

### 3. Place Input Files
Place your CSV files inside the directory specified in `ALLOWED_FILE_BASE_DIR` (resolves to the project root `./` or `./data`).
For immediate testing, sample files `user_transactions.csv` and `exchange_transactions.csv` have already been set up in the root folder!

### 4. Run Application
- **Development Mode (HMR with Nodemon):**
  ```bash
  npm run dev
  ```
- **Production Start:**
  ```bash
  npm start
  ```

---

## API Endpoints

### 1. health health check (`GET /health`)
Returns general server stats, environment info, and uptime.
```bash
curl http://localhost:3000/health
```

### 2. Trigger Reconciliation (`POST /reconcile`)
Launches the dual-source ingestion and fuzzy matching pipeline in the background. Enforces absolute path traversal guards and file size safety.
- **Request Body:**
  ```json
  {
    "userFilePath": "user_transactions.csv",
    "exchangeFilePath": "exchange_transactions.csv",
    "config": {
      "timestampToleranceSecs": 300,
      "quantityTolerancePct": 0.01
    }
  }
  ```
- **Command:**
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"userFilePath": "user_transactions.csv", "exchangeFilePath": "exchange_transactions.csv"}' \
    http://localhost:3000/reconcile
  ```
- **Response (202 Accepted):**
  ```json
  {
    "runId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "status": "PENDING",
    "triggeredAt": "2026-05-23T17:40:00.000Z"
  }
  ```

### 3. Fetch Full Report (`GET /report/:runId`)
Returns paginated report items including categories, matching scores, and reasons.
- **Query Params:** `page` (default 1), `limit` (default 100), `category` (optional MATCHED/CONFLICTING/UNMATCHED_USER/UNMATCHED_EXCHANGE filter)
```bash
curl http://localhost:3000/report/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d?page=1&limit=5
```

### 4. Fetch Summary counts (`GET /report/:runId/summary`)
Returns aggregate counts, file level checksums, and execution metrics.
```bash
curl http://localhost:3000/report/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d/summary
```

### 5. Fetch Unmatched Only (`GET /report/:runId/unmatched`)
Returns paginated list of unmatched rows along with quality issues or matching failure reasons.
```bash
curl http://localhost:3000/report/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d/unmatched
```

### 6. Side-by-Side CSV Export (`GET /report/:runId/download`)
Generates and downloads a complete CSV featuring user and exchange fields side-by-side.
```bash
curl -o report.csv http://localhost:3000/report/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d/download
```

---

## Data Quality Flag Codes

| Flag | Meaning |
|---|---|
| `MISSING_FIELD` | Mandatory cell (timestamp, asset, type, quantity) was blank or absent |
| `INVALID_TIMESTAMP` | Value was unparseable under standard ISO 8601 or regional formats |
| `FUTURE_TIMESTAMP` | Date was set further than 1 hour in the future (beyond clock drift buffer) |
| `INVALID_QUANTITY` | Quantity parsed to NaN, negative, zero, or infinity |
| `QUANTITY_OVERFLOW` | Quantity exceeded the safety cap limit (1e15) |
| `UNKNOWN_ASSET` | Asset was not resolvable under canonical alias tables (e.g. BTC, ETH) |
| `UNKNOWN_TYPE` | Type was not mapping to BUY, SELL, TRANSFER, FEE, or REWARD |

---

## Core Design Decisions

1. **Modern ES Modules (ESM):** Utilizes Node.js native ESM (`import/export`) for modular, forward-compatible engineering. Named logger extensions guarantee seamless compatibility.
2. **Binary Search Candidate Windowing:** During the fuzzy matching step, the exchange transactions are pre-sorted and target ranges are sliced using a custom $O(\log n)$ binary search. This ensures the algorithm scales gracefully to hundreds of thousands of rows without hitting a quadratic CPU bottleneck.
3. **Decimal.js Precision:** Floating point arithmetic drift (e.g., IEEE 754 precision issues like `0.1 + 0.2 = 0.30000000000000004`) can cause false quantity conflicts when applying micro-level percentage tolerances. Using `Decimal.js` eliminates this class of bugs.
4. **Idempotency Hashing:** Computes SHA-256 fingerprints of files and configuration parameters during run initialization to prevent processing duplicate files repeatedly, conserving resources.
5. **NoSQL Injection and Security Guards:** Implements Express Mongo Sanitize and rigid directory-boundary path guards to block malicious file path query attempts (`../../etc/passwd`).

---

## Testing

A comprehensive suite of unit and integration tests is set up. Integration tests run against `mongodb-memory-server` ensuring 100% execution isolation.

- **Run All Tests:**
  ```bash
  npm run test
  ```
- **Run Unit Tests only:**
  ```bash
  npm run test:unit
  ```
- **Run Integration Tests only:**
  ```bash
  npm run test:int
  ```
- **Run Code Coverage Analysis:**
  ```bash
  npm run test:coverage
  ```
