# Implementation Status

## Current state

The repository contains an early Goal 1 discovery prototype. It is not a production-ready release and it does not yet perform nationwide ingestion.

**CI:** Provenance and CSV import passed earlier GitHub Actions checks. Automatic identity resolution has now been committed; its CI run is pending verification. Windows installation/runtime verification remains pending.

## Implemented in source

- React + TypeScript + Vite dashboard shell.
- Fastify API bound to localhost.
- SQLite persistence under the user's local application data directory.
- Source registry seed for OpenStreetMap.
- One bounded Overpass restaurant query at a time per API process.
- Candidate fields for name, category, address, phone, website, email, source object URL, observation timestamp, and raw source payload.
- Field-level provenance table for source-specific values, collection timestamps, upstream timestamps, verification status, and optional confidence.
- OSM adapter records individual field observations without marking them verified.
- Candidate provenance API returns observations and conflicting values for human review.
- CSV parser handles quoted fields, escaped quotes, CRLF, duplicate headers, and malformed quotes.
- Local CSV import API accepts up to 5,000 rows / 1.5 MB, creates an import job, and stores each field as unverified source provenance.
- Dashboard has a CSV import panel and reloads imported records into candidate review.
- Basic candidate review status changes.\n- Automatic cross-source identity resolution using normalized Pakistani phone numbers, website domains, name similarity, and address/branch conflict guards.\n- Unified business profile tables, source-record links, confidence/reason metadata, and automatic merge history.\n- API endpoints for unified profiles and matching status; discovery and CSV imports trigger matching automatically.\n- Dashboard panel for unified business profiles.\n- Matching unit tests for phone/domain normalization, positive matches, false positives, and branch conflicts.
- GitHub Actions typecheck/build workflow.

## Documented, not yet implemented

- Pakistan-wide geographic registry and versioned boundary data.
- Tile planner and persistent resumable nationwide batch jobs.
- Pause/resume/cancel and per-tile progress UI/API.
- Local Pakistan/regional OSM extract importer.
- Stable-ID deduplication across overlapping tiles and sources.
- Additional external source adapters beyond OSM and operator-supplied CSV.
- Merge rollback and split/reassign workflow; current automatic links preserve original source records but cannot yet be undone in the UI.
- Source policy version snapshots.
- Pakistani phone normalization.
- Candidate-to-lead promotion and lead management.
- CSV export and data-quality report.
- Full API integration tests, Windows installation verification, backup/restore.
- Complete security review of source ingestion and UI.

## Important limitations

- The current API requires an operator-supplied WGS84 bounding box and enforces a small area limit.
- It only searches OSM restaurant tags; it does not cover all Pakistani businesses or all cities.
- OSM may contain few or no restaurant phone/website tags in a given area.
- A missing field means the source did not provide it, not that the business lacks it.
- The adapter intentionally does not use Google Maps.
- Overpass is a shared service; a failed request must not be interpreted as zero results.
- Do not run repeated queries to work around rate limits.
- The current candidate table is a staging view, not a verified lead CRM.

## Run locally

From repository root:
1. Install Node.js 24.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

API health: `http://127.0.0.1:4317/api/health`

The local database is stored under the Windows user's LocalAppData folder in `RumiReach/data` by default. Do not commit this data folder or export files.

## Next implementation order

1. Add reviewable cross-source entity matching and duplicate suggestions; do not merge on name alone.
2. Add import batch management, CSV export, and field-level quality reporting.
3. Add a versioned Pakistan geography registry with source/licence metadata.
4. Add a deterministic tile planner and strict tile-size validation.
5. Add persistent tile tasks, checkpoints, retry-after handling and cancellation.
6. Add stable-source-ID deduplication, regional quality metrics, and a local OSM extract importer.
7. Add a separately reviewed business-website enrichment adapter and permitted government/open-data adapters.
