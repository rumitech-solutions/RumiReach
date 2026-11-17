# Implementation Status

## Initial Goal 1 vertical slice

A first prototype has been committed. It is an early development build, not a production-ready release. It has not yet been installed or executed on the user's Windows machine, and the CI workflow has not reported a completed run.

Implemented in source:
- React + TypeScript + Vite dashboard shell.
- Fastify API bound to localhost.
- SQLite persistence under the user's local application data directory.
- Source registry seed for OpenStreetMap.
- One bounded Overpass restaurant query at a time per API process.
- Candidate fields for name, category, address, phone, website, email, source object URL, observation timestamp, and raw source payload.
- Basic candidate review status changes.
- Initial GitHub Actions typecheck/build workflow.

Not yet implemented:
- Reviewed Gulshan-e-Iqbal boundary / bounding box.
- Candidate-to-lead promotion and lead management.
- Field-level observation history and source policy version snapshots.
- Duplicate suggestions.
- Pakistani phone normalization.
- CSV export and quality report.
- Persistent job queue and job cancellation.
- Automated tests, Windows installation verification, backup/restore.
- Complete security review of source ingestion and UI.

## Important limitations
- OSM may contain few or no restaurant phone/website tags in the pilot area.
- The adapter intentionally does not use Google Maps.
- Overpass is a shared service; a failed request must not be interpreted as zero results.
- Do not run repeated queries to work around rate limits.
- The current candidate table is a staging view, not a verified lead CRM.
- Search currently requires an operator-reviewed bounding box; do not guess coordinates.

## Run locally
From repository root:
1. Install Node.js 24.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

API health: `http://127.0.0.1:4317/api/health`

The local database is stored under the Windows user's LocalAppData folder in `RumiReach/data` by default. Do not commit this data folder or export files.
