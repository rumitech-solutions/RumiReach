# RumiReach

**Import. Organize. Manage.**

RumiReach is a local-first CSV business-lead workspace by RumiTech Solutions. Import a business dataset that you are authorized to use, clean and organize its core contact fields, review records, search/filter the list, and export the filtered results.

## Current product scope

1. Import CSV files through the browser File Stream API and send rows in small batches; there is no application-defined total row-count or file-size cap. Practical limits depend on the computer, browser, disk and processing time.
2. Accept `name`, `business_name`, `title`, `restaurant_name` or `business` as the required business-name header.
3. Normalize common scraper fields including `complete_address`, `phone_number`, `website_url`, and Maps listing links, alongside category, address, email and source URL.
4. Parse import API responses defensively and show actionable HTTP/API errors rather than a generic JSON parsing exception.
5. Store imported values locally as unverified source observations.
6. Search and filter on the server, browse paginated results, manually review, and export the full filtered result set through a streamed CSV response.
7. Edit one shared WhatsApp message draft; it remains saved in browser local storage and supports business-name/category placeholders.
8. Add one shared JPG, PNG or WebP image for all business drafts; it is stored in this browser's IndexedDB and can be previewed, replaced or removed. Where the browser supports file sharing, the default WhatsApp action opens the system share sheet with the personalized text and image. Otherwise it opens the text draft and downloads the image so it can be attached manually.
9. Optional WAHA integration can send the selected image with the personalized draft as its caption, but only after the operator records explicit opt-in evidence for that contact. Opt-outs are suppressed; image type/size checks, local safety limits and a per-send confirmation are enforced.

The dashboard is CSV-first. Large files are read incrementally in the browser and committed in batches, so the full CSV does not need to be held in memory at once. If a batch fails, previously committed batches remain saved and should be checked before retrying. WAHA is disabled by default and can be enabled from the WhatsApp draft panel settings. When disabled, the WhatsApp button shares the editable draft and selected image through the browser's file-sharing sheet where supported; browsers without file sharing open the text draft and download the image for manual attachment. When enabled and configured locally, a separate WAHA send action appears only for contacts with recorded explicit opt-in evidence and sends the selected image as a captioned image message; each send requires per-message operator confirmation. WAHA is an unofficial WhatsApp Web integration and may carry account-restriction risk; it is not an official Meta API. It does not perform live business discovery or connect to OSM, Overpass, Nominatim, Google Places, or other discovery providers. The repository retains some legacy schema/modules from the earlier prototype, but the current API and dashboard do not expose or run those discovery flows.

## Navigation and collections

The sidebar has separate pages: **Overview**, **Find leads**, **Import CSV**, **Collections** and **All businesses**. Every search run and CSV import is saved as a named *collection* (give it a name when you start, or one is generated). From **Collections** you can open a list (filters All businesses to it), export just that list, rename it, **merge** it into another collection, or delete it with its businesses. In All businesses, tick rows (or the header box) to **Accept / Reject / Needs review / Delete** many at once, and use the **Has phone / website / email** chips to narrow a list; exports are named after the collection. **Clean duplicates** removes repeats (same phone number, or same name and address) and keeps one of each, preferring records you already reviewed. A **Contacted** status helps track outreach. The Overview lists your latest collections. Finished searches have **Run again**; businesses can also be deleted individually.

## Find leads automatically (Google Maps scraper)

The dashboard's **Find leads** panel runs the bundled scraper (`services/gmaps-scraper`, vendored from gosom/google-maps-scraper) on your own computer:

1. Type one or more search terms (e.g. `dentist`), choose **country → state → city** (leave city empty to cover the first N cities of the state), set depth, and optionally email lookup.
2. RumiReach builds queries such as `dentist in Lahore, Punjab, Pakistan`, runs the scraper, and imports the CSV into your directory as unverified records. Businesses already saved (same Maps link) are skipped.

Setup (one of):
- **Docker Desktop** (easiest on Windows): nothing to build; the `gosom/google-maps-scraper` image is pulled on first run.
- **Local binary**: install Go, then `npm run build:scraper` (also installs the Playwright browser). Override the path with `RUMIREACH_SCRAPER_BIN`.

The country/state/city list (dr5hn/countries-states-cities-database, ODbL) is downloaded once on first use and cached in the local data folder. Optional env vars: `RUMIREACH_SCRAPE_CONCURRENCY` (default 2), `RUMIREACH_SCRAPE_MAX_MINUTES` (default 120), `RUMIREACH_SCRAPER_IMAGE`.

Automated collection from Google Maps may violate Google's terms and local privacy/anti-spam law; the panel requires you to confirm you are authorized, and responsibility for use of the data stays with you.

## Optional WhatsApp (WAHA) — one click

With Docker Desktop installed, open the WhatsApp draft panel → **Optional integration settings** → enable WAHA → **Start WhatsApp service**. RumiReach runs the official `devlikeapro/waha` image (first run downloads it), bound to `127.0.0.1` only with a generated private API key stored in the local data folder, then shows the pairing QR code right in the dashboard. No separate repo or `.env` is needed. Optional env vars: `RUMIREACH_WAHA_IMAGE`, `RUMIREACH_WAHA_ENGINE` (e.g. `NOWEB`).

## Moving to another laptop

Install Node.js 24 and Docker Desktop, clone this repo, run `npm install` and `npm run dev`. The Google Maps scraper (Docker image) and the WhatsApp service (Docker image) are pulled automatically on first use. Your data lives in the local data folder (`%LOCALAPPDATA%\RumiReach\data` on Windows), so copy that folder to keep your collections.

## Advanced WAHA setup (manual)

Configure the API process environment (never the browser) with:

- `WAHA_BASE_URL=http://127.0.0.1:3000`
- `WAHA_SESSION=default`
- `WAHA_API_KEY=<your WAHA API key>`

Start WAHA locally, pair its session with the WhatsApp account using the WAHA QR flow, then restart RumiReach API. RumiReach intentionally accepts only localhost WAHA endpoints. Open the WhatsApp draft panel → **Optional integration settings** → enable WAHA. The dashboard then checks connection status. For each contact, choose **Opted in** and record when/how permission was given; choose **Opted out** to suppress future sends. Each send requires confirmation and is limited to one message per contact per 24 hours, at least 30 seconds apart, and 20 sends per local day. These are conservative local guardrails, not WhatsApp-approved quotas or a guarantee against account restrictions. WAHA is an unofficial integration; for supported business messaging use the official Meta WhatsApp Cloud API.

## Data-use responsibility

Import only datasets you are authorized to collect, store, and reuse. A CSV file's availability or a scraper's open-source license does not grant permission to reuse the underlying third-party data. RumiReach does not verify imported business details or source permissions automatically.

## Run locally

1. Install Node.js 24.
2. From the repository root run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

API health: `http://127.0.0.1:4317/api/health`

SQLite data is stored under `%LOCALAPPDATA%\\RumiReach\\data` on Windows by default. Do not commit the local database or exported lead files.

## License

No repository license has been selected. Until one is added, all rights are reserved; do not assume this project is open source.
