# Implementation Status

## Current state

The repository contains an early Goal 1 discovery prototype. It is not a production-ready release and it does not yet perform nationwide ingestion.

**CI:** Provenance and CSV import passed earlier GitHub Actions checks. Automatic identity resolution has now been committed; its CI run is pending verification. Windows installation/runtime verification remains pending.

## Implemented in source

- React + TypeScript + Vite dashboard shell.
- Fastify API bound to localhost.
- SQLite persistence under the user's local application data directory.
- Source registry seed for OpenStreetMap.
- Bounded, category-aware Overpass discovery processed sequentially through one local API worker queue.
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

- Versioned Pakistan-wide geographic registry and authoritative municipal boundary data.
- Multi-city nationwide batch orchestration.
- Pause/cancel controls (failed/interrupted tile retry and per-tile progress are implemented).
- Local Pakistan/regional OSM extract importer.
- Stable-ID deduplication across separate jobs and independent source adapters (OSM object IDs are already deduplicated within a job across its tiles).
- Additional external source adapters beyond OSM and operator-supplied CSV.
- Merge rollback and split/reassign workflow; current automatic links preserve original source records but cannot yet be undone in the UI.
- Source policy version snapshots.
- Pakistani phone normalization.
- Candidate-to-lead promotion and lead management.
- CSV export and data-quality report.
- Full API integration tests, Windows installation verification, backup/restore.
- Complete security review of source ingestion and UI.

## Important limitations

- The operator must look up and select a city/place boundary; the selected bounding box is tiled automatically.
- It searches configured OSM business categories, but does not cover every business or every city.
- OSM may contain few or no public phone/website tags for businesses in a given area.
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

 
## Business discovery expansion (2026-11-17)

- Expanded discovery request validation from restaurant-only to 27 category choices, including a bounded "all common businesses" mode.
- Generalized the Overpass adapter to build category-specific OpenStreetMap tag queries and store the source's business tags as normalized category evidence.
- Dashboard now lets the operator choose a business category before discovery.
- Kept the existing small bounding-box limit, per-process single-request guard, result cap, field provenance, and OSM attribution.
- Overpass HTTP 429/503 is now reported as a source availability/rate-limit failure, never as an empty result.
- Google Maps scraping is intentionally excluded: free scraper code does not grant rights to export/store Google Maps content. Do not integrate scraping repos or proxy/CAPTCHA bypasses.
- This is still a bounded-area OSM connector, not automatic city boundary discovery, nationwide coverage, Overture ingestion, or website contact enrichment. Those remain next phases.
- CSV remains an optional utility; automatic location/category discovery is the primary workflow.

## Automatic Pakistan city lookup (2026-11-17)

- Added a user-triggered Pakistan city lookup API backed by public Nominatim search.
- Search results are cached in SQLite and the API serializes lookups with a 1.1-second minimum interval; no autocomplete or background geocoding is used.
- Dashboard can fetch candidate city/place boundaries and populate the existing coordinate fields after the operator selects a result.
- The operator must review the selected boundary. This is a geocoded place bounding box, not guaranteed to be a legal municipal boundary.
- The existing Overpass search remains area-limited and single-request. Large city extents still require the separately planned tile scheduler; this commit does not claim nationwide or full-city coverage.
- OSM attribution is displayed with geocoding results. Public Nominatim is a constrained shared service; see https://operations.osmfoundation.org/policies/nominatim/.

## Persistent city tile discovery (2026-11-17)

- Added a deterministic geographic tile planner. Each tile is at most 0.05 degrees on each axis, keeping individual Overpass queries within the existing small-area safety envelope.
- Added a hard cap of 500 tiles per job. Larger boundaries are rejected with a request to select a smaller city/locality area rather than launching unbounded work.
- Discovery jobs now persist tile bounds and per-tile status/checkpoints in SQLite.
- A single in-process worker queue serializes discovery jobs and processes tiles sequentially; the API does not fan out concurrent Overpass requests.
- The search endpoint returns a job ID immediately. Progress is available from `GET /api/jobs/:id`, including completed, queued, failed and skipped tile counts.
- Failed tiles can be retried through `POST /api/jobs/:id/resume`. Running tile checkpoints are returned to the queue after an API restart; the operator can resume the job.
- Candidate identity remains deduplicated by source object type and OSM ID within each discovery job; the job-level maximum result count is enforced across tiles.
- Dashboard now polls tile progress and exposes a retry action after a failed job.
- Tests cover tile boundaries, remainder edges, invalid extents and the 500-tile cap.
- This is bounded, resumable tile discovery—not a promise of complete city coverage. It still depends on OSM tagging density, Overpass availability, selected boundary quality and the per-job result cap. The tile cap can require the operator to choose a smaller locality.
- Current job processing is local to one API process. Multi-instance distributed locking, pause/cancel controls, durable automatic startup resumption, per-city coverage analytics and additional data sources remain future work.
