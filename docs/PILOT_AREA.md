# Pakistan-Wide Coverage Scope

## Product scope
RumiReach is intended to discover and qualify public business records across **all of Pakistan**. The coverage model must not be hard-coded to Gulshan-e-Iqbal or Karachi.

The nationwide scope includes, as source data permits:
- All provinces and territories
- Major cities, smaller cities, towns and localities
- Multiple business categories, introduced incrementally after the restaurant discovery workflow is reliable

## Initial validation category
- Category: Restaurants
- Geographic scope: Pakistan
- Validation target: measure source coverage across a representative set of cities and regions; this is a measurement exercise, not a promise of a fixed number of records.
- Do not treat the earlier Gulshan-e-Iqbal 50-record idea as the product boundary.

## Nationwide ingestion strategy
Do **not** send one enormous country-sized query to a shared Overpass endpoint. Partition coverage into manageable geographic units (for example, city/locality tiles), process sequentially with caching and rate limits, persist progress, and allow interrupted jobs to resume.

Before enabling a nationwide run:
1. Define a Pakistan administrative/locality index and a versioned set of geographic boundaries.
2. Validate each boundary and retain its source, licence, retrieval date and geometry.
3. Query only bounded areas or use an appropriately licensed Pakistan/regional extract for bulk ingestion.
4. Deduplicate OSM elements across overlapping tiles using stable source identifiers (type + OSM ID).
5. Record per-field provenance, source timestamp and missing-field status.
6. Provide job progress, retry/backoff for transient errors, and explicit handling for 429/503/timeouts.
7. Run a small representative coverage test before expanding the batch.

## Current prototype limitation
The current prototype accepts a manually supplied WGS84 bounding box and makes a bounded Overpass query. It is not yet a nationwide crawler/importer. Nationwide support requires the geographic partitioning, job queue/resume, caching, deduplication and source-compliance work described above.

## Data quality and honest reporting
- Report counts by province/territory, city/locality and category where source tags permit.
- Measure name, address, phone, website and public-email completeness independently.
- A missing phone or website means the source did not provide that tag; it does not prove the business lacks one.
- Report duplicates, boundary spillover, query failures and source freshness separately.
- Never describe the database as a complete directory of Pakistani businesses unless completeness is independently established.

## Source and usage caveats
The initial open data source is OpenStreetMap, subject to ODbL attribution and applicable share-alike obligations. OSM is community-maintained and business metadata coverage varies. Shared Overpass services are not a free unlimited bulk-ingestion backend: use modest sequential queries, caching and backoff; for larger recurring workloads, evaluate a suitable regional extract or self-hosted service and its operating costs. Do not scrape Google Maps or copy/export its business listings into RumiReach.

## Next implementation milestones
1. Pakistan geographic hierarchy and boundary registry.
2. Resumable, rate-limited geographic batch jobs.
3. Stable-source-ID deduplication across overlapping areas.
4. Field-level provenance and data-quality reporting.
5. CSV export and reviewed lead promotion.
