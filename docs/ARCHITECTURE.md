# System Architecture

Status: approved MVP direction. Principle: local-first modular monolith with source-aware ingestion.

## 1. Overview

Browser dashboard → local Fastify API → application services → permitted source adapters → source endpoints. The application persists source registry, search jobs, candidates, leads, field observations, and review decisions in a local SQLite database. CSV export is generated from approved lead records.

## 2. Approved MVP stack

- Runtime: Node.js 24 LTS/current supported release, npm workspaces.
- Frontend: React + TypeScript + Vite.
- Backend: TypeScript + Fastify.
- Shared contracts: Zod schemas in a local shared package.
- Database: SQLite using better-sqlite3, with versioned SQL migrations.
- Tests: Vitest for unit/integration tests; browser E2E tooling is optional and not required for Goal 1.
- HTTP: built-in Fetch API for outbound source requests; no browser automation for the OSM adapter.
- Runtime: Windows local development; optional Docker Compose only if it simplifies reproducibility.

No paid API, hosted database, AI provider, n8n, Scrapy, Crawl4AI, or Google Maps scraper is a required dependency.

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
tests/                 cross-module fixtures and integration helpers
```

Local database, logs, exports, and backups live under the user's local application data directory, not inside the Git repository.

## 4. Modules

- Search orchestration: validates search criteria, applies limits, creates jobs, tracks progress, and supports cancellation.
- Source registry: stores source policy, permitted fields, attribution, rate limits, and review date.
- Source adapters: each declares source ID, policy URL, permitted fields, attribution, request limits, query, parser, and health check.
- Candidate review: accept, reject, merge, or mark needs-review.
- Validation: Pakistani phone normalization, URL syntax checks, duplicate suggestions, field freshness, and provenance.
- Lead management: accepted business records, notes, edits, and status history.
- Export: documented UTF-8 CSV with source and verification metadata.

Adapters must fail closed when source permission or policy is unknown. Technical accessibility is not permission.

## 5. Goal 1 data flow

1. User submits bounded category/city/locality search.
2. Backend validates input and enabled source policy.
3. A job is created with request/record limits and cancellation.
4. OSM adapter sends one bounded Overpass query for the selected area and tag set.
5. Adapter parses OSM object IDs/tags and records OSM base timestamp and attribution.
6. Normalizer creates candidate records and field-level provenance.
7. Duplicate detection suggests matches; ambiguous cases require human review.
8. User approves/rejects candidates.
9. Approved records become leads.
10. User exports selected records and quality metrics.

Do not silently geocode arbitrary locality text. Use a reviewed boundary or operator-confirmed bounding box for the first pilot. Do not silently switch to Google Maps or another source when OSM coverage is sparse.

## 6. Reliability and resource limits

- One active Overpass request at a time for the MVP.
- Conservative request timeout and a bounded result size.
- Cache identical queries and preserve the OSM base timestamp.
- Respect HTTP 429 and Retry-After; stop rather than retry in a tight loop.
- No automatic parallel retries; no per-object follow-up requests.
- User can cancel jobs; cancellation prevents further outbound requests.
- Logs include job/source/status/duration/counts, not unnecessary personal data.
- A source outage is shown as a partial/failed job, never as zero businesses.

## 7. Website checker SSRF controls (later phase)

Accept only HTTP(S); reject localhost, private, loopback, link-local, multicast, and reserved IP ranges; resolve and validate DNS addresses before connecting; revalidate redirects; cap redirects, ports, bytes, and time; do not execute downloaded files; sandbox browser rendering with strict network controls.

## 8. Deployment

Run locally on Windows and bind API to 127.0.0.1 by default. Store database outside the repository. Remote deployment requires a separate threat model, authentication, authorization, TLS, backups, and cost review.

## 9. Evolution

Do not split services prematurely. Consider PostgreSQL only when measured concurrency or volume justifies it. Browser automation and AI-assisted analysis remain optional later capabilities.
