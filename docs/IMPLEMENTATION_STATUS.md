# Implementation Status

## Current product direction

RumiReach is now a local-first CSV business-lead workspace. The dashboard no longer offers live discovery. The active workflow is: import an authorized CSV dataset → normalize and store records → search/filter/review → export the filtered list.

## Implemented

- React + TypeScript + Vite dashboard.
- Fastify API bound to localhost.
- SQLite persistence under the Windows user's LocalAppData directory.
- CSV parser supports quoted commas, escaped quotes, CRLF, duplicate-header checks, and malformed-quote errors.
- CSV import accepts `name` or `business_name`, plus category, address, phone, website, email and source_url fields.
- CSV import has no application-defined row-count or file-size cap; practical limits depend on available RAM, disk space, browser memory and SQLite processing time.
- Website URL normalization and safe source URL fallback.
- Field-level source observations are stored as unverified; imported data is not automatically represented as verified.
- Dashboard supports CSV upload, record search, category and review-status filters, sorting, manual review status changes, and filtered CSV export.
- Candidate list API returns all imported CSV records.
- Existing identity matching can group high-confidence duplicate records while retaining original source records.

## Not part of the active product

- Live business discovery from OSM, Overpass, Nominatim, Overture or Google Places.
- Automated Google Maps scraping or a scraper runner.
- Website crawling/contact enrichment.
- WhatsApp sending or automated outreach.
- Hosted multi-tenant SaaS.

Some legacy OSM/geography/tile source files, schema tables and historical documentation remain in the repository from the earlier prototype. They are not imported by the current API entrypoint and are not exposed in the current dashboard. Existing local SQLite data is not automatically deleted.

## Important limits

- Imported records are only as accurate and complete as the CSV source.
- A populated phone, address or website is not proof that it is current or verified.
- Only import datasets you are authorized to collect, store and reuse. Open-source scraper code does not grant reuse rights to the data it collects.
- The UI currently displays the core business fields: name, category, address, phone, website and email. Extra columns in an imported CSV are not yet available as first-class searchable fields.

## Run locally

1. Install Node.js 24.
2. Run `npm install` from the repository root.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

API health: `http://127.0.0.1:4317/api/health`

Local database: `%LOCALAPPDATA%\\RumiReach\\data\\rumireach.sqlite` by default.
