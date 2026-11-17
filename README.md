# RumiReach

**Import. Organize. Manage.**

RumiReach is a local-first CSV business-lead workspace by RumiTech Solutions. Import a business dataset that you are authorized to use, clean and organize its core contact fields, review records, search/filter the list, and export the filtered results.

## Current product scope

1. Import CSV files through the browser File Stream API and send rows in small batches; there is no application-defined total row-count or file-size cap. Practical limits depend on the computer, browser, disk and processing time.
2. Accept `name` or `business_name` as the required business-name header.
3. Normalize website URLs and map common field names for category, address, phone, website, email and source URL.
4. Store imported values locally as unverified source observations.
5. Search and filter on the server, browse paginated results, manually review, and export the full filtered result set through a streamed CSV response.
6. Edit one shared WhatsApp message draft; open a selected business chat with the message prefilled for the operator to review and send manually. The draft is saved in the current browser.

The dashboard is CSV-first. Large files are read incrementally in the browser and committed in batches, so the full CSV does not need to be held in memory at once. If a batch fails, previously committed batches remain saved and should be checked before retrying. WhatsApp integration only opens a user-initiated chat with prefilled text; RumiReach does not send messages, automate outreach, or access WhatsApp accounts. The draft is stored in browser local storage. It does not perform live business discovery or connect to OSM, Overpass, Nominatim, Google Places, or other discovery providers. The repository retains some legacy schema/modules from the earlier prototype, but the current API and dashboard do not expose or run those discovery flows.

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
