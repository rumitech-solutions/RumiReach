# Implementation Status

## Current product direction

RumiReach is now a local-first CSV business-lead workspace. The dashboard no longer offers live discovery. The active workflow is: stream an authorized CSV dataset → commit rows in batches → search/filter on the server → browse paginated results → review → export the current page.

## Implemented

- React + TypeScript + Vite dashboard.
- Fastify API bound to localhost.
- SQLite persistence under the Windows user's LocalAppData directory.
- CSV parser supports quoted commas, escaped quotes, CRLF, duplicate-header checks, and malformed-quote errors.
- CSV import accepts `name`, `business_name`, `title`, `restaurant_name` or `business` as business-name fields, with common scraper aliases such as `complete_address`, `phone_number`, `website_url` and `link`.
- Import responses are parsed defensively so empty/non-JSON API responses show actionable status details rather than a generic JSON parsing exception.
- CSV files are read incrementally with the browser File Stream API and sent to the API in 500-row batches. There is no application-defined total row-count or file-size cap; practical limits depend on available RAM, disk space, browser and SQLite processing time.
- Each batch is committed independently. If a later batch fails, earlier batches remain saved; the incomplete import must be reviewed before retrying.
- Candidate search, category/status filters, sorting and counts run server-side. The UI loads 25 rows per page rather than loading the whole database.
- CSV export streams the entire filtered result set from the API; the browser does not build one giant export string.
- A single shared WhatsApp draft is editable in the dashboard and saved in browser local storage. Business-name and category placeholders are personalized when a row's WhatsApp action is clicked.
- One shared JPG, PNG or WebP outreach image (up to 5 MB) can be uploaded, previewed, replaced and removed. It is persisted in this browser's IndexedDB, separately from the message draft.
- The default WhatsApp action uses the browser file-sharing sheet to share text + image where supported. Otherwise it opens the selected business chat with the editable text and downloads the image for manual attachment; the browser share sheet may require choosing the recipient manually.
- Optional WAHA sending can send the selected image with the personalized draft as its caption. Image sends retain the explicit per-contact opt-in, opt-out suppression, confirmation and local rate limits; image MIME type, signature and size are checked server-side.
- Per-lead WhatsApp consent is stored with evidence; opt-outs suppress sending and a public phone number is never treated as consent.
- Optional WAHA integration sends only to explicitly opted-in contacts after per-message operator confirmation. Local guardrails enforce a 30-second gap, 20 messages per local day, and one send per contact per 24 hours.
- WAHA URL is restricted to localhost and its API key stays server-side. WAHA is an unofficial WhatsApp Web integration; account restrictions remain possible.
- Website URL normalization and safe source URL fallback.
- Field-level source observations are stored as unverified; imported data is not automatically represented as verified.
- Dashboard supports CSV upload, record search, category and review-status filters, sorting, manual review status changes, and filtered CSV export.
- Candidate list API returns filtered, sorted, paginated records and workspace-wide summary counts.
- Identity matching tables and utilities remain in the codebase, but automatic matching is deferred to avoid expensive all-record matching during imports or API startup.

## Not part of the active product

- Live business discovery from OSM, Overpass, Nominatim, Overture or Google Places.
- Hosted/cloud scraping. (A local Google Maps scraper runner with country/state/city selection is now available in the **Find leads** panel; see README.)
- Website crawling/contact enrichment.
- Unsolicited/bulk WhatsApp messaging, sending without opt-in evidence, and unattended campaign blasts. One-contact-at-a-time WAHA sending is implemented behind consent and operator confirmation.
- Hosted multi-tenant SaaS.

Some legacy OSM/geography/tile source files, schema tables and historical documentation remain in the repository from the earlier prototype. They are not imported by the current API entrypoint and are not exposed in the current dashboard. Existing local SQLite data is not automatically deleted.

## Important limits

- Imported records are only as accurate and complete as the CSV source.
- A populated phone, address or website is not proof that it is current or verified.
- Only import datasets you are authorized to collect, store and reuse. Open-source scraper code does not grant reuse rights to the data it collects.
- The UI currently displays the core business fields: name, category, address, phone, website and email. Extra columns in an imported CSV are retained in raw row provenance but are not yet first-class searchable fields.

## Run locally

1. Install Node.js 24.
2. Run `npm install` from the repository root.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

API health: `http://127.0.0.1:4317/api/health`

Local database: `%LOCALAPPDATA%\\RumiReach\\data\\rumireach.sqlite` by default.
