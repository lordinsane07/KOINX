# KoinX — Transaction Reconciliation Engine
## Product Requirements Document · v1.0

> **Document Status:** Final — Submission Ready  
> **Classification:** Confidential / Internal  
> **Target Audience:** KoinX Engineering & Product Team  
> **Date:** June 2025

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Scope & Constraints](#2-project-scope--constraints)
3. [System Architecture](#3-system-architecture)
4. [Data Models](#4-data-models)
5. [Ingestion Module](#5-ingestion-module)
6. [Matching Engine](#6-matching-engine)
7. [Reconciliation Report](#7-reconciliation-report)
8. [REST API Specification](#8-rest-api-specification)
9. [Project Structure & Engineering Standards](#9-project-structure--engineering-standards)
10. [Configuration Reference](#10-configuration-reference)
11. [Testing Strategy](#11-testing-strategy)
12. [Key Design Decisions & Assumptions](#12-key-design-decisions--assumptions)
13. [Setup & Deployment](#13-setup--deployment)
14. [Success Criteria](#14-success-criteria)
- [Appendix A — Asset Alias Map](#appendix-a--asset-alias-map)
- [Appendix B — Transaction Type Map](#appendix-b--transaction-type-map)
- [Appendix C — Quality Flag Codes](#appendix-c--quality-flag-codes)

---

## 1. Executive Summary

This document defines the complete product requirements for the **KoinX Transaction Reconciliation Engine** — a production-grade Node.js microservice that ingests dual-source crypto transaction data, executes a configurable fuzzy-matching algorithm, and delivers a structured reconciliation report via a REST API.

### Problem Statement

Crypto tax and accounting platforms routinely face a fundamental data-quality challenge: the same transaction looks different depending on who exported it. User wallets truncate timestamps, exchanges round quantities, and neither side uses consistent type labels. Without a systematic reconciliation layer, downstream tax calculations silently absorb these discrepancies — producing incorrect tax liabilities at scale.

> Two CSV exports of the same crypto account activity differ in timestamp precision, quantity rounding, transaction-type nomenclature, and data completeness. A naive row-by-row comparison produces false mismatches and misses true conflicts. The engine must bridge these gaps deterministically, with full auditability and **zero silent data loss**.

### Solution at a Glance

| Step | Action |
|------|--------|
| **1. Ingest** | Parse both CSVs with schema enforcement and row-level error logging |
| **2. Store** | Persist raw + sanitised records in MongoDB with full provenance |
| **3. Match** | Execute a multi-pass algorithm with configurable tolerance windows |
| **4. Report** | Emit a four-category reconciliation report as CSV + DB records |
| **5. Expose** | Four REST endpoints for triggering runs and querying results |

---

## 2. Project Scope & Constraints

### 2.1 In Scope

- CSV ingestion with robust parsing (encoding issues, BOM, trailing commas, quoted fields)
- Row-level data quality flagging — **no silent drops**
- MongoDB persistence of raw, validated, and reconciliation records
- Configurable fuzzy-matching on timestamp, quantity, asset, and transaction type
- Asset alias resolution (`BTC` ↔ `Bitcoin`, `ETH` ↔ `Ether`, `USDT` ↔ `Tether`)
- Perspective-aware type mapping (`TRANSFER_IN` ↔ `TRANSFER_OUT`)
- Four-category report generation (Matched / Conflicting / Unmatched-User / Unmatched-Exchange)
- Run-scoped report storage with unique `runId`
- Four REST API endpoints with OpenAPI-aligned design
- Configuration via env vars, config file, or request body
- Structured logging with Winston
- Unit + integration tests with Jest

### 2.2 Out of Scope

- Front-end UI or dashboard
- Real-time streaming ingestion (Kafka, WebSockets)
- Multi-exchange API integrations
- Authentication / authorisation layer (assumed handled by gateway)
- Historical replay or time-travel queries

---

## 3. System Architecture

The engine is structured as a **layered Node.js application** with clean separation of concerns across five distinct layers:

```
┌─────────────────────────────────────────────────────────┐
│                        API Layer                        │
│         Express.js routes · validation · serialisation  │
├─────────────────────────────────────────────────────────┤
│                      Service Layer                      │
│      Ingestion service · Matching service · Reporter    │
├─────────────────────────────────────────────────────────┤
│                    Repository Layer                     │
│          All MongoDB interactions (no raw queries       │
│                    in service layer)                    │
├─────────────────────────────────────────────────────────┤
│                      Domain Layer                       │
│     Pure functions: matchers · normalisers · validators │
│                    (zero I/O)                           │
├─────────────────────────────────────────────────────────┤
│                    Infrastructure                       │
│         DB connection · logger · config · CSV utils     │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Data Flow

```
POST /reconcile
    │
    ▼
Ingest CSVs (streaming)
    │
    ▼
Validate + Flag rows
    │
    ├── Valid rows ──────────────────────────────────────┐
    │                                                    │
    ▼                                                    ▼
Persist raw records                             Persist with isValid=false
(all rows, always)                              + qualityFlags[]
    │
    ▼
Normalise (aliases, canonical types, UTC timestamps)
    │
    ▼
Pass 1: Exact ID Match (txHash / exchangeId)
    │
    ▼
Pass 2: Fuzzy Proximity Match (timestamp ± Δt, quantity ± Δq%)
    │
    ▼
Pass 3: Conflict Detection (ID-matched but fields beyond tolerance)
    │
    ▼
Pass 4: Remainder → UNMATCHED_USER / UNMATCHED_EXCHANGE
    │
    ▼
Write Report (CSV on disk + MongoDB entries)
    │
    ▼
Return { runId, status: "RUNNING" } → 202 Accepted
```

> Every step writes an audit entry. Failures at any step are recorded with a detailed reason; the run is marked `PARTIAL` rather than failing entirely.

### 3.2 Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 20 LTS | Mandated; async I/O ideal for CSV streaming |
| Framework | Express.js 4 | Minimal, battle-tested, easy to test |
| Database | MongoDB 7 via Mongoose | Schema flexibility for messy CSV data |
| CSV Parsing | `csv-parse` (streaming) | Handles BOM, quoted fields, encoding |
| Logging | Winston + `daily-rotate-file` | Structured JSON logs, log levels |
| Config | `dotenv` + Joi validation | Typed env vars with defaults |
| Testing | Jest + Supertest | Unit and integration coverage |
| Code Quality | ESLint (Airbnb) + Prettier + Husky | Pre-commit hooks, zero-warning policy |
| API Docs | `swagger-jsdoc` + `swagger-ui-express` | Auto-generated from JSDoc |

---

## 4. Data Models

### 4.1 Raw Transaction

Stored immediately upon ingestion before any normalisation. Preserves the original data faithfully.

```javascript
// RawTransaction — MongoDB Collection: raw_transactions
{
  _id:          ObjectId,       // MongoDB document identifier
  runId:        String,         // Links record to a reconciliation run
  source:       "user" | "exchange",
  rawData:      Object,         // Original CSV row, key-value as parsed
  rowIndex:     Number,         // 1-based row number in source CSV
  isValid:      Boolean,        // false if any quality issue detected
  qualityFlags: String[],       // e.g. ["MISSING_TIMESTAMP", "INVALID_QUANTITY"]
  createdAt:    Date,           // Ingestion timestamp
}
```

### 4.2 Normalised Transaction

```javascript
// NormalisedTransaction — MongoDB Collection: normalised_transactions
{
  _id:              ObjectId,
  rawTransactionId: ObjectId,   // Ref → RawTransaction
  runId:            String,
  source:           "user" | "exchange",
  timestamp:        Date,        // Parsed + validated ISO date (UTC)
  asset:            String,      // Canonical ticker, always uppercase (e.g. "BTC")
  type:             String,      // Canonical type after alias resolution
  quantity:         Decimal128,  // High-precision numeric value
  txHash:           String,      // Exchange transaction hash if present
  exchangeId:       String,      // Exchange-side transaction ID
}
```

### 4.3 Reconciliation Run

```javascript
// ReconciliationRun — MongoDB Collection: reconciliation_runs
{
  _id:          ObjectId,
  runId:        String,          // UUID v4 — used in all API paths
  status:       "PENDING" | "RUNNING" | "COMPLETE" | "PARTIAL",
  config:       {
    timestampToleranceSecs: Number,
    quantityTolerancePct:   Number,
    requireExactType:       Boolean,
  },
  summary: {
    matched:            Number,
    conflicting:        Number,
    unmatchedUser:      Number,
    unmatchedExchange:  Number,
    totalUserRows:      Number,
    totalExchangeRows:  Number,
    qualitySummary: {
      user:     { total, valid, invalid, flagBreakdown: Object },
      exchange: { total, valid, invalid, flagBreakdown: Object },
    }
  },
  triggeredAt:  Date,
  completedAt:  Date,
  errorLog:     String[],        // Run-level errors (not row-level)
}
```

### 4.4 Reconciliation Report Entry

```javascript
// ReportEntry — MongoDB Collection: report_entries
{
  _id:            ObjectId,
  runId:          String,
  category:       "MATCHED" | "CONFLICTING" | "UNMATCHED_USER" | "UNMATCHED_EXCHANGE",
  userRecord:     Object | null,    // Original user-side row
  exchangeRecord: Object | null,    // Original exchange-side row
  matchScore:     Number,           // 0–100 composite similarity score
  reason:         String,           // Human-readable categorisation rationale
  conflictDetails: [                // Populated for CONFLICTING only
    {
      field:          String,
      userValue:      String,
      exchangeValue:  String,
      delta:          String,       // e.g. "0.023%" or "187 seconds"
    }
  ],
}
```

---

## 5. Ingestion Module

### 5.1 CSV Parsing Strategy

The parser must handle deliberately messy files. The following pre-processing steps are applied **before** schema validation:

1. Strip UTF-8 BOM (`\uFEFF`) from file start
2. Trim whitespace from all headers and values
3. Normalise line endings (`CRLF` → `LF`)
4. Parse quoted fields correctly — internal commas and newlines within quotes
5. Detect and skip entirely blank rows (log as `INFO`, not `ERROR`)
6. Detect duplicate headers and alias to `header_1`, `header_2`

### 5.2 Schema Validation Rules

| Field | Rule | Flag Code on Failure |
|-------|------|---------------------|
| `timestamp` | Parseable date (ISO 8601, or common regional formats) | `INVALID_TIMESTAMP` |
| `timestamp` | Not in the future (> now + 1 hour) | `FUTURE_TIMESTAMP` |
| `asset` | Non-empty string, resolves to known alias | `UNKNOWN_ASSET` |
| `type` | Non-empty, maps to canonical type list | `UNKNOWN_TYPE` |
| `quantity` | Positive decimal, not NaN or Infinity | `INVALID_QUANTITY` |
| `quantity` | Below 1e15 (sanity cap) | `QUANTITY_OVERFLOW` |
| *(any required)* | Missing or null | `MISSING_FIELD` |

### 5.3 Data Quality Policy

> **Non-negotiable: Zero Silent Drops**
>
> - Every row in every CSV is stored in MongoDB — valid or not.
> - Invalid rows have `isValid=false` and one or more `qualityFlags` entries.
> - Invalid rows are **excluded from the matching engine** but **appear in the report** as `UNMATCHED` with the flag as the reason.
> - A quality summary (`totalRows`, `validRows`, `invalidRows`, `flagBreakdown`) is attached to every run.

---

## 6. Matching Engine

The matching engine is the core IP of this service. It uses a **multi-pass strategy** to maximise precision while remaining configurable.

### 6.1 Pass Strategy

| Pass | Name | Logic |
|------|------|-------|
| **1** | Exact ID Match | Match on `txHash` or `exchangeId` if both are non-null and identical |
| **2** | Fuzzy Proximity Match | Match on `timestamp ± tolerance` AND `quantity ± tolerance%` AND canonical `asset` AND canonical `type` |
| **3** | Conflict Detection | Rows matched by ID in Pass 1 that fail field tolerances → `CONFLICTING` |
| **4** | Remainder | Any user record with no match → `UNMATCHED_USER`; any exchange record → `UNMATCHED_EXCHANGE` |

### 6.2 Normalisation Before Matching

All records are normalised before any comparison:

- **Asset aliases** resolved via a configurable alias map (see [Appendix A](#appendix-a--asset-alias-map))
- All asset strings converted to **uppercase canonical ticker**
- **Type aliases** resolved: `TRANSFER_IN` ↔ `TRANSFER_OUT` (perspective flip), `DEPOSIT=BUY=CREDIT`, `WITHDRAWAL=SELL=DEBIT`
- Quantities parsed as `Decimal128` for precision — no floating-point drift
- Timestamps parsed as **UTC milliseconds** for arithmetic comparison

### 6.3 Tolerance Configuration

| Parameter | Default | Configurable Via |
|-----------|---------|-----------------|
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` (5 min) | Env var, config file, or POST body |
| `QUANTITY_TOLERANCE_PCT` | `0.01%` | Env var, config file, or POST body |
| `REQUIRE_EXACT_TYPE` | `false` | Env var — set `true` for strict mode |
| `MAX_CANDIDATE_WINDOW` | `1000` | Env var — limits fuzzy search space |

### 6.4 Match Scoring

Each candidate pair receives a **composite match score (0–100)** used to break ties when multiple candidates exist within tolerance:

| Dimension | Max Points | Scoring |
|-----------|-----------|---------|
| Timestamp delta | 40 | Linearly scaled within tolerance window |
| Quantity delta | 40 | Linearly scaled within tolerance % |
| Type exact match | 10 | Binary (10 if exact, 0 if alias match) |
| `txHash` match | 10 | Binary bonus |

> The highest-scoring candidate wins. In the event of a tie, the **earlier exchange record** is preferred (deterministic ordering).

### 6.5 Candidate Pre-filtering

Before scoring, candidates are pre-filtered using a **time-bucketed index** (sorted array of timestamps per source). Only records within `± MAX_CANDIDATE_WINDOW` rows of the target timestamp bucket are scored. This prevents O(n²) complexity on large datasets.

```
Time complexity: O(n log n) sort + O(n · w) matching
where w = average candidates per window (bounded by MAX_CANDIDATE_WINDOW)
```

---

## 7. Reconciliation Report

### 7.1 Output Categories

| Category | Definition |
|----------|------------|
| `MATCHED` | Paired records where all fields agree within configured tolerances |
| `CONFLICTING` | Records linked by ID or proximity but differ beyond tolerance on quantity or timestamp |
| `UNMATCHED_USER` | User record with no exchange counterpart found in any pass |
| `UNMATCHED_EXCHANGE` | Exchange record with no user counterpart found in any pass |

### 7.2 Report CSV Schema

The output CSV contains the following columns. All original source columns are preserved by prefixing with `user_` or `exchange_`.

| Column | Description |
|--------|-------------|
| `category` | One of the four category values above |
| `reason` | Plain-English explanation of categorisation |
| `matchScore` | Numeric 0–100 (empty for `UNMATCHED`) |
| `user_*` | All columns from the user CSV row (null for `UNMATCHED_EXCHANGE`) |
| `exchange_*` | All columns from the exchange CSV row (null for `UNMATCHED_USER`) |
| `conflict_fields` | Pipe-separated list of diverging fields (`CONFLICTING` only) |
| `conflict_delta_quantity` | Absolute and percentage delta (`CONFLICTING` only) |
| `conflict_delta_seconds` | Timestamp difference in seconds (`CONFLICTING` only) |

### 7.3 Sample Report Rows

```csv
category,reason,matchScore,user_timestamp,user_asset,user_quantity,user_type,exchange_timestamp,exchange_asset,exchange_quantity,exchange_type,conflict_fields,conflict_delta_quantity,conflict_delta_seconds
MATCHED,"Fuzzy match within tolerance: Δt=42s Δq=0.003%",94,2024-01-15T10:00:42Z,BTC,0.5001,BUY,2024-01-15T10:00:00Z,Bitcoin,0.5,DEPOSIT,,,
CONFLICTING,"ID match but quantity delta (1.5%) exceeds tolerance (0.01%)",71,2024-01-16T08:00:00Z,ETH,1.015,SELL,2024-01-16T08:00:00Z,ETH,1.0,WITHDRAWAL,quantity,0.015 (1.5%),0
UNMATCHED_USER,"No exchange counterpart found within timestamp±300s and quantity±0.01%",,2024-01-17T12:00:00Z,SOL,10.0,BUY,,,,,,,
UNMATCHED_EXCHANGE,"No user counterpart found; possible missing import",,,,,,2024-01-18T09:00:00Z,DOGE,500.0,DEPOSIT,,,
```

---

## 8. REST API Specification

### 8.1 Endpoint Catalogue

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/reconcile` | Trigger a reconciliation run |
| `GET` | `/report/:runId` | Fetch full report for a run |
| `GET` | `/report/:runId/summary` | Fetch summary counts only |
| `GET` | `/report/:runId/unmatched` | Fetch only unmatched rows with reasons |

### 8.2 `POST /reconcile`

Triggers a new reconciliation run. The run executes asynchronously; the response returns immediately with a `runId` for polling.

**Request Body** (`application/json`):

```json
{
  "userFilePath": "./data/user_transactions.csv",
  "exchangeFilePath": "./data/exchange_transactions.csv",
  "config": {
    "timestampToleranceSecs": 300,
    "quantityTolerancePct": 0.01,
    "requireExactType": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userFilePath` | `string` | ✅ | Path to user CSV |
| `exchangeFilePath` | `string` | ✅ | Path to exchange CSV |
| `config.timestampToleranceSecs` | `number` | ❌ | Override default `300` |
| `config.quantityTolerancePct` | `number` | ❌ | Override default `0.01` |
| `config.requireExactType` | `boolean` | ❌ | Override default `false` |

**Response `202 Accepted`**:

```json
{
  "runId": "a3f9c2e1-8b7d-4e5f-91a0-c2d3e4f5a6b7",
  "status": "RUNNING",
  "message": "Reconciliation started. Poll /report/:runId for results."
}
```

**Error Responses**:

| Code | Scenario |
|------|----------|
| `400` | Missing required fields or invalid config values |
| `422` | Files found but completely unparseable |
| `500` | Unexpected server error (sanitised message; full error in logs) |

---

### 8.3 `GET /report/:runId`

Fetch the full reconciliation report for a completed run.

**Query Parameters**:

| Param | Default | Description |
|-------|---------|-------------|
| `page` | `1` | Page number |
| `limit` | `100` | Entries per page |
| `category` | *(all)* | Filter by category |

**Response `200 OK`**:

```json
{
  "runId": "a3f9c2e1-...",
  "status": "COMPLETE",
  "summary": { "matched": 42, "conflicting": 3, "unmatchedUser": 5, "unmatchedExchange": 2 },
  "pagination": { "page": 1, "limit": 100, "total": 52 },
  "entries": [ { ... } ]
}
```

**Error Responses**:

| Code | Scenario |
|------|----------|
| `202` | Run still in progress (includes partial results if available) |
| `404` | `runId` not found |

---

### 8.4 `GET /report/:runId/summary`

Lightweight endpoint — returns counts only, no entry data.

**Response `200 OK`**:

```json
{
  "runId": "a3f9c2e1-...",
  "status": "COMPLETE",
  "summary": {
    "matched": 42,
    "conflicting": 3,
    "unmatchedUser": 5,
    "unmatchedExchange": 2,
    "totalUserRows": 52,
    "totalExchangeRows": 50,
    "qualitySummary": {
      "user":     { "total": 52, "valid": 50, "invalid": 2, "flagBreakdown": { "MISSING_FIELD": 2 } },
      "exchange": { "total": 50, "valid": 49, "invalid": 1, "flagBreakdown": { "INVALID_QUANTITY": 1 } }
    },
    "durationMs": 1247
  }
}
```

---

### 8.5 `GET /report/:runId/unmatched`

Returns only `UNMATCHED_USER` and `UNMATCHED_EXCHANGE` entries with reasons.

**Query Parameters**: same `page` / `limit` / `category` as `/report/:runId`

**Response `200 OK`**:

```json
{
  "runId": "a3f9c2e1-...",
  "totalUnmatched": 7,
  "entries": [
    {
      "category": "UNMATCHED_USER",
      "reason": "No exchange counterpart within Δt=300s and Δq=0.01%",
      "userRecord": { "timestamp": "2024-01-17T12:00:00Z", "asset": "SOL", "quantity": "10.0", "type": "BUY" }
    }
  ]
}
```

---

## 9. Project Structure & Engineering Standards

### 9.1 Directory Layout

```
koinx-reconciliation/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── reconcile.routes.js
│   │   │   └── report.routes.js
│   │   ├── middleware/
│   │   │   ├── errorHandler.js
│   │   │   ├── requestLogger.js
│   │   │   └── validateBody.js
│   │   └── validators/
│   │       ├── reconcile.validator.js
│   │       └── report.validator.js
│   ├── services/
│   │   ├── ingestion.service.js
│   │   ├── matching.service.js
│   │   └── report.service.js
│   ├── repositories/
│   │   ├── rawTransaction.repo.js
│   │   ├── normalisedTransaction.repo.js
│   │   ├── reconciliationRun.repo.js
│   │   └── reportEntry.repo.js
│   ├── domain/
│   │   ├── matchers/
│   │   │   ├── exactId.matcher.js
│   │   │   ├── fuzzyProximity.matcher.js
│   │   │   └── scoring.js
│   │   ├── normalisers/
│   │   │   ├── asset.normaliser.js
│   │   │   ├── type.normaliser.js
│   │   │   ├── timestamp.normaliser.js
│   │   │   └── quantity.normaliser.js
│   │   └── validators/
│   │       └── row.validator.js
│   ├── infrastructure/
│   │   ├── db.js
│   │   ├── logger.js
│   │   ├── config.js
│   │   └── constants.js
│   └── app.js
├── tests/
│   ├── unit/
│   │   ├── domain/
│   │   │   ├── asset.normaliser.test.js
│   │   │   ├── type.normaliser.test.js
│   │   │   ├── scoring.test.js
│   │   │   └── row.validator.test.js
│   │   └── services/
│   │       ├── ingestion.service.test.js
│   │       └── matching.service.test.js
│   └── integration/
│       ├── reconcile.test.js
│       └── report.test.js
├── config/
│   └── default.json
├── data/
│   ├── user_transactions.csv
│   └── exchange_transactions.csv
├── docs/
│   └── openapi.yaml
├── scripts/
│   └── seed.js
├── .env.example
├── .eslintrc.js
├── .prettierrc
├── jest.config.js
├── package.json
└── README.md
```

### 9.2 Commit Convention

All commits follow the **Conventional Commits** specification. This produces a parseable commit history and enables automated changelog generation.

```
feat(ingestion): add BOM stripping and encoding normalisation
feat(matching): implement three-pass strategy with composite scoring
feat(matching): add time-bucketed index for O(n log n) candidate selection
feat(api): expose POST /reconcile with async run + runId response
feat(api): add GET /report/:runId with pagination support
fix(normaliser): handle quantity values in scientific notation
test(domain): add unit tests for asset alias resolver (14 cases)
test(integration): add round-trip test POST /reconcile → GET /report
chore: add Husky pre-commit hooks for lint + format
docs: add OpenAPI annotations to all four endpoints
refactor(matching): extract scoring logic to pure scoring.js module
```

### 9.3 Code Quality Standards

- **ESLint Airbnb config** — zero warnings policy enforced by CI
- **Prettier formatting** — enforced via pre-commit Husky hook
- **JSDoc** on all exported functions and classes
- **No magic numbers** — all constants in `src/infrastructure/constants.js`
- **No `process.env` reads** outside `src/infrastructure/config.js`
- **All async functions** use `async/await` — no raw Promise chains
- **All errors** thrown as typed `AppError` subclasses (`IngestionError`, `MatchingError`, `ReportError`)
- **Repository pattern** — services never touch Mongoose models directly

---

## 10. Configuration Reference

All variables are validated at startup via **Joi schema**. Missing required variables or type mismatches cause a **hard exit** with a clear error message — no zombie processes with silent misconfiguration.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `MONGODB_URI` | *(required)* | MongoDB connection string |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Matching window in seconds |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Quantity tolerance as percentage |
| `REQUIRE_EXACT_TYPE` | `false` | Disallow type alias mapping if `true` |
| `MAX_CANDIDATE_WINDOW` | `1000` | Max candidates per fuzzy pass |
| `LOG_LEVEL` | `info` | Winston log level |
| `LOG_DIR` | `logs/` | Directory for log files |
| `NODE_ENV` | `development` | `production` disables stack traces in API responses |

**Precedence order** (highest to lowest):

```
POST /reconcile body config
    ↓
Environment variables
    ↓
config/default.json
```

---

## 11. Testing Strategy

### 11.1 Test Levels

| Level | Scope | Tooling |
|-------|-------|---------|
| **Unit** | Domain functions: alias resolver, quantity comparator, timestamp comparator, normaliser | Jest |
| **Unit** | Service layer with mocked repositories | Jest + manual mocks |
| **Integration** | `POST /reconcile` → full DB write → `GET /report/:runId` round-trip | Supertest + `mongodb-memory-server` |
| **Edge Cases** | Empty CSVs, all-invalid rows, zero matches, all-matched, duplicate IDs | Jest parameterised (`test.each`) |

### 11.2 Key Test Scenarios

| Scenario | Expected Outcome |
|----------|-----------------|
| Timestamp exactly at tolerance boundary | `MATCHED` (inclusive) |
| Timestamp 1 second beyond tolerance | `UNMATCHED` |
| Quantity delta 0.009% | `MATCHED` |
| Quantity delta 0.011% (default tolerance 0.01%) | `CONFLICTING` |
| `TRANSFER_IN` on exchange ↔ `TRANSFER_OUT` on user | `MATCHED` |
| `BTC` on user ↔ `Bitcoin` on exchange | `MATCHED` |
| Row with `MISSING_FIELD` flag | Not matched; `UNMATCHED` with flag reason |
| Duplicate `txHash` in exchange file | Second row flagged `DUPLICATE_ID` |
| User file is empty | All exchange rows → `UNMATCHED_EXCHANGE` |
| Config override in POST body | Overrides env var for that run only |
| `runId` not found | `404` response |
| Run still in progress | `202` with partial results |

### 11.3 Coverage Target

> **Target: > 80% line coverage** on domain and service layers.  
> Infrastructure and repository layers covered by integration tests.

---

## 12. Key Design Decisions & Assumptions

The assignment deliberately leaves several requirements ambiguous. The following documents decisions made, with rationale, as required by the submission brief.

| Ambiguity | Decision | Rationale |
|-----------|----------|-----------|
| **File delivery mechanism** (path vs upload vs URL) | Accept file paths in POST body | Simplest for a backend-only service; avoids multipart complexity; straightforward to extend |
| **Synchronous vs asynchronous run** | Asynchronous — `POST` returns `runId` immediately | Realistic for large files; prevents HTTP timeout on slow machines |
| **Type mapping exhaustiveness** | Alias map is data-driven in `config/default.json`, not hardcoded | Allows extension without code changes |
| **Tie-breaking in fuzzy match** | Composite score (40+40+10+10); earlier exchange record wins ties | Deterministic; reproducible |
| **Report delivery format** | CSV written to disk + all entries stored in MongoDB | Covers both API consumption and file download scenarios |
| **Invalid row handling** | Stored with flags, excluded from matching, included in report as `UNMATCHED` with flag reason | Zero silent drops |
| **Pagination on report endpoint** | `page` + `limit` query params; MongoDB cursor-based for large result sets | Avoids memory pressure on large reports |
| **Run idempotency** | Each `POST /reconcile` creates a new run | Intentional; preserves full audit trail |
| **`TRANSFER_IN` ↔ `TRANSFER_OUT` resolution** | Treated as the same canonical type `TRANSFER` before matching | One transaction, two perspectives; matching on perspective-normalised type is correct |
| **Quantity precision** | `Decimal128` in MongoDB; `decimal.js` in Node for arithmetic | Floating-point errors would create false conflicts |

---

## 13. Setup & Deployment

### 13.1 Prerequisites

- Node.js 20 LTS
- MongoDB 7 (local instance or Atlas)
- npm 10+

### 13.2 Installation

```bash
git clone <repo-url>
cd koinx-reconciliation
npm install
cp .env.example .env
# Edit .env and set MONGODB_URI
```

### 13.3 Running the Service

```bash
# Development (with hot reload)
npm run dev

# Production
npm start

# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage
```

### 13.4 Triggering a Reconciliation Run

```bash
# Trigger a run with defaults
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{
    "userFilePath": "./data/user_transactions.csv",
    "exchangeFilePath": "./data/exchange_transactions.csv"
  }'

# Response:
# { "runId": "a3f9c2e1-...", "status": "RUNNING" }

# Poll for results
curl http://localhost:3000/report/a3f9c2e1-.../summary

# Trigger with custom tolerances
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{
    "userFilePath": "./data/user_transactions.csv",
    "exchangeFilePath": "./data/exchange_transactions.csv",
    "config": {
      "timestampToleranceSecs": 600,
      "quantityTolerancePct": 0.05,
      "requireExactType": true
    }
  }'
```

### 13.5 Viewing API Documentation

```bash
# Swagger UI available at:
http://localhost:3000/api-docs
```

---

## 14. Success Criteria

| Criterion | Definition of Done |
|-----------|-------------------|
| **Zero silent drops** | Every CSV row present in MongoDB after ingestion (verified by test) |
| **Correct categorisation** | All four categories populated correctly on sample data |
| **Configurable tolerances** | POST body overrides env var; env var overrides `default.json` |
| **Type & asset aliases** | `BTC=Bitcoin` and `TRANSFER_IN↔TRANSFER_OUT` confirmed by unit test |
| **All four endpoints** | Return documented response shapes; `404` on unknown `runId` |
| **Clean code** | ESLint zero warnings; Prettier formatted; all functions JSDoc'd |
| **Test coverage** | > 80% line coverage on domain and service layers |
| **README completeness** | Setup, design decisions, and API usage documented |
| **Commit hygiene** | All commits follow Conventional Commits spec |
| **No magic numbers** | All constants centralised in `constants.js` |

---

## Appendix A — Asset Alias Map

| Canonical Ticker | Known Aliases |
|-----------------|---------------|
| `BTC` | Bitcoin, bitcoin, XBT |
| `ETH` | Ether, ethereum, Ethereum |
| `USDT` | Tether, tether, USD-T |
| `SOL` | Solana, solana |
| `BNB` | BinanceCoin, Binance Coin, binance-coin |
| `ADA` | Cardano, cardano |
| `DOGE` | Dogecoin, dogecoin |
| `MATIC` | Polygon, polygon, POLYGON |

> The alias map is defined in `config/default.json` under the key `assetAliases` and can be extended without code changes.

---

## Appendix B — Transaction Type Map

| Canonical Type | Aliases |
|---------------|---------|
| `BUY` | DEPOSIT, CREDIT, buy, deposit, credit |
| `SELL` | WITHDRAWAL, DEBIT, sell, withdrawal, debit |
| `TRANSFER` | TRANSFER_IN, TRANSFER_OUT *(perspective flip — same canonical type)* |
| `FEE` | fee, Fee, CHARGE |
| `REWARD` | reward, STAKING_REWARD, INTEREST |

> The type map is defined in `config/default.json` under `typeAliases` and is loaded at startup.

---

## Appendix C — Quality Flag Codes

| Flag Code | Meaning |
|-----------|---------|
| `MISSING_FIELD` | A required column is null or empty |
| `INVALID_TIMESTAMP` | Timestamp cannot be parsed as a date |
| `FUTURE_TIMESTAMP` | Timestamp is more than 1 hour in the future |
| `INVALID_QUANTITY` | Quantity is NaN, Infinity, zero, or negative |
| `QUANTITY_OVERFLOW` | Quantity exceeds 1e15 (sanity cap) |
| `UNKNOWN_ASSET` | Asset string cannot be resolved to any known alias |
| `UNKNOWN_TYPE` | Type string cannot be resolved to any canonical type |
| `DUPLICATE_ID` | `txHash` or `exchangeId` already seen in this source file |

---

*End of Document · KoinX Transaction Reconciliation Engine PRD v1.0*