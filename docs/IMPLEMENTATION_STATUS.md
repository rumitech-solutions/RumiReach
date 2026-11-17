# Implementation Status

## Initial Goal 1 scaffold

This is an early vertical slice, not a production-ready release.

Implemented:
- React + TypeScript + Vite dashboard shell.
- Fastify API bound to localhost.
- SQLite persistence under the user's local application data directory.
- Source registry seed for OpenStreetMap.
- One bounded Overpass restaurant query per active process.
- Candidate fields for name, category, address, phone, website, email, source object URL, observation timestamp, and raw source payload.
- Basic candidate review status changes.

Not yet implemented:
- Reviewed Gulshan-e-Iqbal boundary / bounding box.
- Candidate-to-lead promotion and lead management.
- Field-level observation history and source policy version snapshots.
- Duplicate suggestions.
- Pakistani phone normalization.
- CSV export and quality report.
- Job cancellation and persistent job queue.
- Automated tests, Windows installation verification, backup/restore.
- Complete security review of source ingestion and UI.

## Important limitations
- OSM may contain few or no restaurant phone/website tags in the pilot area.
- The adapter intentionally does not use Google Maps.
- Overpass is a shared service; a failed request must not be interpreted as zero results.
- Do not run repeated queries to work around rate limits.
- The current candidate table is a staging view, not a verified lead CRM.

## Run locally (after installing dependencies)
From repository root:
1. \`npm install\`
2. \`npm run dev\`
3. Open \`http://127.0.0.1:5173\`

API health: \`http://127.0.0.1:4317/api/health\`

Before running a search, enter an operator-reviewed bounding box for the target locality. Do not guess coordinates.
