# Data Acquisition Strategy

## Why open-source tools appear to have business data

An open-source scraper is usually an extraction engine, not a business-data provider. It obtains information from a separate source chosen by its operator. The source may be a public website, an official API, an open-data download, a directory, a user-supplied file, or a database the operator already maintains.

The tool generally performs this pipeline:

1. **Seed**: receive a URL, search query, geographic area, category, API endpoint, or input file.
2. **Fetch**: request a page/API response or load a local dataset.
3. **Parse**: extract fields from HTML, JSON, XML, CSV, or another format.
4. **Normalize**: map source-specific fields into a common business schema.
5. **Validate and deduplicate**: check field formats and compare source identifiers or business attributes.
6. **Persist/export**: write records to a database, CSV, JSON, or another destination.

For example, Scrapy supplies reusable crawling machinery: spiders produce requests, a scheduler queues them, a downloader fetches responses, and item pipelines clean, validate, deduplicate, and store extracted items. Scrapy itself does not supply a directory of businesses.

## Common acquisition methods

| Method | Where the records originate | Typical mechanism | RumiReach position |
|---|---|---|---|
| Open geospatial data | OpenStreetMap contributors | Overpass queries or country/region extracts in PBF format | Initial enabled source, subject to ODbL and service rules |
| Official/open government data | Government departments and public-data portals | Download/API with dataset-specific terms | Add after source-by-source review |
| Business-owned websites | The business itself | Low-volume HTTP fetch and structured-data/HTML parsing | Potential enrichment source; review terms and access rules |
| Licensed directory/API | Directory or data provider | Official API or licensed export | Only if licence permits intended use; paid services are not an MVP dependency |
| User-provided files | User's own research, CRM, or permitted CSV | CSV/XLSX import and validation | Good source option; retain import provenance |
| Search engines/maps | Search or mapping platform | Official API or website interface | Do not scrape/export Google Maps content into RumiReach |
| Social networks | Platform and business accounts | Official API or business-owned public links | Only permitted API/use; no personal-profile scraping |

A tool may combine several methods. Some products also rely on a prebuilt dataset, commercial provider, cloud service, proxy network, or paid API. “Open source” describes the availability/licence of the tool's code; it does **not** mean the data source is open, free, unlimited, accurate, or licensed for reuse.

## Examples from the audited projects

- **Scrapy** is a general-purpose crawling framework. The operator writes spiders that specify which permitted sites to fetch and how to parse them. Its scheduler/downloader/pipeline architecture is reusable, but it does not contain business listings.
- **Crawl4AI** is a web-crawling and extraction framework. It fetches pages selected by the operator and turns page content into structured output; it does not create the underlying business facts.
- **Playwright** automates real browsers for pages that require browser rendering or interaction. It is an automation layer, not a directory or data source.
- **Google Maps scraper repositories** automate extraction from Google Maps pages or interfaces. Their records originate from Google Maps. This does not make that reuse permitted: Google Maps terms prohibit extracting/scraping Maps content for use outside the services, including copying business names and addresses. RumiReach will not import those records.
- **OpenStreetMap tooling** reads community-mapped OSM objects. The source is the OSM database, not the scraper. ODbL attribution and share-alike obligations apply, and public API endpoints have separate usage limits.

## RumiReach source architecture

RumiReach will separate acquisition mechanisms from source adapters:

- **Source registry**: source owner, canonical terms/licence, permitted purpose/fields, attribution, rate limit, caching/retention rules, policy review date, enabled state and disable reason.
- **Geography registry**: versioned Pakistan province/territory, district, city/locality and tile boundaries, each with source, licence and retrieval date.
- **Job planner**: breaks an approved region/category request into small bounded tasks. Jobs are sequential/conservative, resumable, cancellable and observable.
- **Source adapters**: each adapter owns its fetch and parse logic and declares stable source identifiers and provenance.
- **Normalization**: maps source records into the common candidate schema without discarding source-specific fields.
- **Deduplication**: first uses stable source IDs (for OSM: element type + OSM ID), then suggests cross-source matches using normalized name, phone, website and location. Fuzzy matches require review.
- **Field observations**: every sourced field stores source reference, observed time, retrieval method and verification state. Conflicting source values remain traceable.
- **Quality reporting**: show coverage and missing-field rates by source, category and geography; distinguish empty results from failed/incomplete jobs.

## Pakistan-wide rollout

The initial prototype supports one manually supplied bounding box and one bounded Overpass request. It is not a nationwide importer.

Nationwide rollout should use a reviewed Pakistan geography registry and either:
1. a suitable Pakistan/regional OSM extract downloaded from a provider such as Geofabrik, then process it locally; or
2. conservative, sequential, cached Overpass queries for small approved tiles where an extract is not suitable.

Do not use the public Nominatim search endpoint as a systematic POI harvesting service. Its policy explicitly says systematic area queries and downloading all POIs should use planet/extract data instead. Nominatim is a geocoder, not a bulk business directory.

A country-wide run must have checkpoints, retry-after handling, rate limits, deduplication across overlapping tiles, and per-tile results. Never send one huge country-sized query to a shared endpoint.

## Source admission and safety rules

1. A source must pass the admission checklist in [Data Sources and Compliance](DATA_SOURCES_AND_COMPLIANCE.md) before it is enabled.
2. Public visibility and technical accessibility are not permission.
3. Never bypass login, CAPTCHA, paywall, access controls, or rate limits.
4. Do not use Google Maps scraping or copy its business content into RumiReach.
5. Respect source attribution, licence, caching, retention and redistribution requirements.
6. Store only relevant public business information; do not harvest personal profiles or private contact details.
7. Public contact information is not consent for WhatsApp marketing. Outreach remains human-reviewed and consent-gated.

## References

- Scrapy architecture: https://docs.scrapy.org/en/master/topics/architecture.html
- Scrapy concepts and item pipelines: https://doc.scrapy.org/en/master/topics/concepts.html
- OpenStreetMap download options and extracts: https://wiki.openstreetmap.org/wiki/Download
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- Google Maps Platform FAQ and scraping restrictions: https://developers.google.com/maps/faq
- OpenStreetMap copyright/licence: https://www.openstreetmap.org/copyright
- Overpass API policy: https://operations.osmfoundation.org/policies/overpass/
