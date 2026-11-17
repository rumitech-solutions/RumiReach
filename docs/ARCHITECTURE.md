# System Architecture

Status: approved MVP direction. Principle: local-first modular monolith with source-aware, geography-aware ingestion.

## 1. Overview

Browser dashboard → local Fastify API → application services → source adapters → permitted source endpoints or local open-data extracts. The application persists source registry, geography versions, search jobs, tile tasks, candidates, field observations, and review decisions in local SQLite. CSV export is generated from approved lead records.

## 2. Approved MVP stack

- Runtime: Node.js 24 LTS/current supported release, npm workspaces.
- Frontend: React + TypeScript + Vite.
- Backend: TypeScript + Fastify.
- Shared contracts: Zod schemas in a local shared package.
- Database: SQLite using better-sqlite3, with versioned SQL migrations.
- Tests: Vitest for unit/integration tests; browser E2E tooling is optional.
- HTTP: built-in Fetch API for outbound source requests.
- Runtime: Windows local development; optional Docker Compose only if it simplifies reproducibility.

No paid API, hosted database, AI provider, n8n, Scrapy, Crawl4AI, or Google Maps scraper is a required dependency. Open-source projects are research references; RumiReach implements its own application logic.

## 3. Repository layout

```
apps/
  api/                 Fastify API and application services
  web/                 React dashboard
packages/
  shared/              Zod schemas and shared TypeScript types
docs/
  decisions/
  ...
```

Local database, logs, exports, downloaded extracts and backups live under the user's local application data directory, not inside the Git repository.

## 4. Modules

- Search orchestration: validates search criteria, plans jobs, tracks progress, supports pause/resume/cancellation.
- Geography registry: versioned Pakistan province/territory, district, city/locality and tile boundaries with source/licence provenance.
- Source registry: source policy, permitted fields, attribution, rate limits, cache and retention rules, review date.
- Source adapters: each declares source ID, policy URL, permitted fields, attribution, request limits, stable identifiers, query/parser and health check.
- Candidate review: accept, reject, merge, or mark needs-review.
- Validation: Pakistani phone normalization, URL syntax checks, duplicate suggestions, field freshness, and provenance.
- Lead management: accepted business records, notes, edits, and status history.
- Export: documented UTF-8 CSV with source and verification metadata.
- Quality reporting: per-source and per-geography counts, field completeness, duplicates, errors, and freshness.

Adapters must fail closed when source permission or policy is unknown. Technical accessibility is not permission.

## 5. Pakistan-wide ingestion flow

1. User selects Pakistan, one or more provinces/cities/localities, a category, and an enabled source.
2. Backend validates the requested geography against a versioned boundary registry.
3. Job planner splits the selected geometry into small bounded tiles (or schedules an approved local-extract import).
4. Persistent job records track each tile's queued/running/completed/failed status, attempts, source timestamp, result count and error.
5. A conservative worker processes one public Overpass request at a time; it caches identical query results and respects 429/503/Retry-After.
6. Parser records stable OSM element type + ID, tags, source URL, source timestamp and attribution.
7. Normalizer maps fields into candidate records and field-level observations.
8. Deduplication first uses stable source identifiers, then suggests cross-source matches; uncertain matches require human review.
9. Quality reporting distinguishes no matching records from failed, cancelled or partial jobs.
10. User reviews candidates, promotes approved records to leads, and exports selected data.

For larger national imports, prefer a suitable licensed Pakistan/regional OSM extract processed locally rather than a country-sized query to a shared API. Nominatim public search is not a systematic POI harvesting endpoint; use extracts for bulk datasets.

## 6. Reliability and resource limits

- One active Overpass request at a time for the MVP.
- Bounded tile size, result limits, request timeout and response-size limits.
- Cache identical queries and preserve the OSM data timestamp.
- Respect HTTP 429/503 and Retry-After; stop rather than retry in a tight loop.
- Persistent checkpoints; restart resumes only unfinished eligible tasks.
- Cancellation prevents further outbound requests.
- A source outage is shown as a partial/failed job, never as zero businesses.
- Overlapping tile results are deduplicated by stable source identifiers.
- Never automatically switch to another source when one source returns sparse results.

## 7. Website checker SSRF controls (later phase)

Accept only HTTP(S); reject localhost, private, loopback, link-local, multicast, and reserved IP ranges; resolve and validate DNS addresses before connecting; revalidate redirects; cap redirects, ports, bytes, and time; do not execute downloaded files; sandbox browser rendering with strict network controls.

## 8. Deployment

Run locally on Windows and bind API to 127.0.0.1 by default. Store database and extracts outside the repository. Remote deployment requires a separate threat model, authentication, authorization, TLS, backups, and cost review.

## 9. Evolution

Do not split services prematurely. Consider PostgreSQL only when measured concurrency or volume justifies it. Browser automation and AI-assisted analysis remain optional later capabilities.
