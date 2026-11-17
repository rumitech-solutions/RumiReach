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


## Unified multi-source business profiles

The product should present one useful business profile even when its information comes from several independent sources. This is a **source-aware aggregation layer**, not a process that blindly overwrites one source with another.

### How a combined profile works

1. **Collect source records independently.** Keep the original source record and its stable source identifier (for example, OSM element type + OSM ID, or an import batch + row identifier).
2. **Normalize fields.** Convert source-specific names and formats into a shared schema: business name, category, coordinates/address, phone, website, email, opening hours and other supported fields.
3. **Resolve entity identity.** Determine whether two source records refer to the same real-world business. Use strong signals first (same official website, normalized phone, exact source cross-reference); use name + proximity only as a match suggestion. Do not automatically merge ambiguous matches.
4. **Build a canonical profile.** Show the best-supported value for each field while retaining every source observation behind it.
5. **Expose provenance and freshness.** A user can see where a value came from, when RumiReach observed it, whether it was verified, and whether another source disagrees.
6. **Refresh independently.** Updating one source must not erase a value contributed by another source.

### Field-level provenance

Each field observation should retain at least:

- canonical business/entity ID;
- field key and normalized value;
- original/raw value when useful for audit;
- source ID and source-record ID;
- source URL or dataset reference where permitted;
- `source_updated_at` when the source supplies it (nullable);
- `fetched_at` (when RumiReach retrieved the record);
- `observed_at` (when the source says the fact was observed, if known);
- verification state: `unverified`, `format_validated`, `source_confirmed`, or `human_verified`;
- match/merge decision and reviewer where applicable.

Do not invent a source update date. If it is unavailable, display “retrieved on” or “first seen by RumiReach” rather than implying that the business updated the information on that date.

### Conflict handling and display rules

- Keep conflicting values as separate observations; never silently discard them.
- Prefer a recent, directly business-controlled source for contact details only when its ownership and relevance are clear.
- A format check (such as a valid-looking phone number) is not proof that the number belongs to the business.
- A value from multiple independent sources can be marked corroborated, but repeated copies of the same upstream dataset do not count as independent confirmation.
- If evidence is tied or weak, show “needs review” instead of selecting a winner.
- Let reviewers correct a canonical value without deleting its source history.
- Show field-level freshness and verification labels, not one misleading “verified” badge for the entire profile.

### Suggested profile presentation

The business page should show:
- **Current profile:** the selected display values.
- **Sources:** source names and links/references where allowed.
- **Last retrieved:** latest RumiReach fetch time per source.
- **Last observed / source updated:** only when the source provides a trustworthy date.
- **Verification:** unverified, format checked, source confirmed, or human verified.
- **Conflicts:** alternate values and the reason they were not selected.
- **Coverage:** which useful fields are present or missing.

### Matching safeguards

Use a staged matching process:

1. Exact stable source ID: same source object, same record.
2. Strong cross-source evidence: same normalized official website or phone plus compatible name/location.
3. Candidate match: normalized name + geographic proximity + category; queue for review.
4. No reliable match: keep as separate businesses.

Never merge solely because two businesses have similar names or share a building. Preserve the original source records and make merge/unmerge decisions auditable.

### Data model direction

Implement this as separate concepts rather than one flat row:

- `sources`: source registry and licence/policy metadata.
- `source_records`: immutable or versioned source snapshots with stable external identity.
- `businesses`: canonical business profiles.
- `business_source_links`: reviewed or suggested links between canonical businesses and source records.
- `field_observations`: field-level values, provenance, timestamps and verification state.
- `merge_reviews`: candidate matches, evidence, decision and reviewer audit trail.

This is the target model, not a claim that all these tables already exist in the current prototype. Introduce it through additive migrations and tests; preserve the current bbox discovery workflow while migrating.

### Important date distinction

The UI must distinguish these dates:

| Label | Meaning |
|---|---|
| Source updated | Date explicitly supplied by the source; often unavailable |
| Observed | Date the source says the fact was observed; may be unavailable |
| Retrieved by RumiReach | Date/time RumiReach fetched the information |
| Human verified | Date/time a reviewer checked the information |

A fresh retrieval does not prove the underlying business information is fresh. For example, fetching an old directory page today only proves that RumiReach retrieved that page today.

## References

- Scrapy architecture: https://docs.scrapy.org/en/master/topics/architecture.html
- Scrapy concepts and item pipelines: https://doc.scrapy.org/en/master/topics/concepts.html
- OpenStreetMap download options and extracts: https://wiki.openstreetmap.org/wiki/Download
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- Google Maps Platform FAQ and scraping restrictions: https://developers.google.com/maps/faq
- OpenStreetMap copyright/licence: https://www.openstreetmap.org/copyright
- Overpass API policy: https://operations.osmfoundation.org/policies/overpass/


## Google Maps scraper code: explicit exclusion

A repository being MIT-licensed or free does not grant permission to extract data from its upstream website. Google Maps Platform policies prohibit scraping/exporting Maps content for use outside Google services, including copying business names and addresses. RumiReach therefore will not embed Google Maps browser scrapers, proxy rotation, CAPTCHA workarounds, or export pipelines. A future Google integration may only display permitted results inside a compliant Google Maps Platform flow; it must not feed the RumiReach prospect database. See https://developers.google.com/maps/faq and https://developers.google.com/maps/documentation/places/web-service/policies.

The product's primary path is direct discovery from licensed/open datasets and permitted business-owned sources. Never describe a source query as exhaustive: coverage depends on the source's local completeness and tagging.
