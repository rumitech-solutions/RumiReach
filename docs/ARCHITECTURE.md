# System Architecture

Status: proposed MVP architecture. Principle: local-first modular monolith with source-aware ingestion.

## 1. Overview

Browser dashboard → local HTTP API → application services → source adapters → permitted source endpoints. The application persists source registry, search jobs, candidates, leads, observations, and review decisions in a local database. CSV export is generated from approved lead records.

## 2. Proposed stack
- Frontend: TypeScript, React, Vite.
- Backend: choose one implementation before coding—Python/FastAPI or a TypeScript backend. Do not maintain two competing backends.
- Database: SQLite for the single-user MVP, with migrations.
- Tests: language-native unit and integration test tools.
- Runtime: Windows local development; optional Docker Compose for reproducibility.

These are proposals, not locked implementation decisions. Do not make n8n, paid APIs, hosted databases, or AI providers required for Goal 1.

## 3. Modules
- Search orchestration: validates search criteria, applies limits, creates jobs, tracks progress, and supports cancellation.
- Source adapters: each declares source ID, policy URL, permitted fields, attribution, rate limit, search, normalization, and health check.
- Candidate review: accept, reject, merge, or mark needs-review.
- Validation: phone parsing, URL safety, duplicate suggestions, field freshness, and provenance.
- Lead management: accepted business records, notes, edits, and status history.
- Export: documented UTF-8 CSV with source and verification metadata.

Adapters must fail closed when source permission or policy is unknown. Technical accessibility is not permission.

## 4. Data flow
1. User submits bounded search.
2. Backend validates input and source policy.
3. Job is created with limits and cancellation.
4. Adapter retrieves only permitted fields.
5. Normalizer creates candidate records and provenance.
6. Duplicate detection suggests matches; ambiguous cases require human review.
7. User approves/rejects candidates.
8. Approved records become leads.
9. User exports selected records and quality metrics.

## 5. Reliability
- Per-source timeout, concurrency limit, and delay.
- Bounded retries for transient errors with backoff.
- Respect HTTP 429 and Retry-After.
- Limit pages, records, duration, redirects, and response bytes.
- Cancellation stops future requests.
- Logs include job/source/status/duration/counts, not unnecessary personal data.
- Never silently switch to a source with different terms.

## 6. Website checker SSRF controls
Accept only HTTP(S); reject localhost, private, loopback, link-local, multicast, and reserved IP ranges; resolve and validate DNS addresses before connecting; revalidate redirects; cap redirects, ports, bytes, and time; do not execute downloaded files; sandbox browser audits with strict network controls.

## 7. Deployment
Run locally on Windows and bind to localhost by default. Store the database outside the repository. Remote deployment requires a separate threat model, authentication, authorization, TLS, backups, and cost review.

## 8. Evolution
Do not split services prematurely. Consider PostgreSQL only when measured concurrency or volume justifies it.