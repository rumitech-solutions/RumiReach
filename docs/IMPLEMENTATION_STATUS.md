# Implementation Status

## Current state

The repository contains an early Goal 1 discovery prototype. It is not a production-ready release and it does not yet perform nationwide ingestion.

**CI:** GitHub Actions is running against the latest provenance changes. Windows installation/runtime verification remains pending.

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
- Basic candidate review status changes.
- GitHub Actions typecheck/build workflow.

## Documented, not yet implemented

- Pakistan-wide geographic registry and versioned boundary data.
- Tile planner and persistent resumable nationwide batch jobs.
- Pause/resume/cancel and per-tile progress UI/API.
- Local Pakistan/regional OSM extract importer.
- Stable-ID deduplication across overlapping tiles and sources.
- Cross-source ingestion adapters beyond the current OSM discovery adapter.
- Cross-source entity matching and duplicate suggestions.
- Source policy version snapshots.
- Pakistani phone normalization.
- Candidate-to-lead promotion and lead management.
- CSV export and data-quality report.
- Automated tests, Windows installation verification, backup/restore.
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

1. Add automated tests for field observations, provenance retrieval, and conflict detection.
2. Implement an auditable user CSV import adapter.
3. Add cross-source entity matching with reviewable match reasons.
4. Add a versioned Pakistan geography registry with source/licence metadata.
5. Add a deterministic tile planner and strict tile-size validation.
6. Add persistent tile tasks, checkpoints, retry-after handling and cancellation.
7. Add stable-source-ID deduplication, regional quality metrics, and a local OSM extract importer.
