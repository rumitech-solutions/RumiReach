# Open-source Technical Audit — Phase 0

- Review date: 2026-11-17
- Scope: source-level inspection of candidate repositories and official source-policy documentation.
- Decision type: research findings only; no third-party application repository is adopted as a runtime dependency.

## Executive decisions

1. **Reject Google Maps extraction as a RumiReach data-ingestion strategy.** Google's current Maps Platform policy explicitly says not to export, extract, or scrape Maps content for use outside the services, including copying and saving business names, addresses, and reviews. The fact that a scraper is open-source or technically works does not grant permission.
2. **Use OpenStreetMap (OSM) as the first discovery experiment**, with source attribution and an explicit ODbL data lineage. It is not a guaranteed source of phone numbers or websites; local completeness must be measured.
3. **Do not rely on a shared public Overpass endpoint as a production backend.** It is suitable only for a small, manually initiated pilot subject to its live usage policy, throttling, and availability. Cache results and never parallelize or retry aggressively.
4. **Use a source-adapter pipeline inspired by general crawler architecture**, but implement RumiReach's own adapter, provenance, review, and storage code.
5. **Keep website crawling out of the first discovery MVP.** First capture OSM's business-published website tags; direct website audit is a later, separate feature with SSRF defenses.

## Repository-by-repository findings

### A. gosom/google-maps-scraper
- Repository: https://github.com/gosom/google-maps-scraper
- License reported by GitHub: MIT.
- Source inspected: README, `main.go`, `gmaps-extractor.md`, LICENSE.
- Architecture observed: a runner factory selects file, database, browser-install, web-server, or AWS Lambda execution modes; a context-aware runner is cancelled on process termination. README documents CLI, Web UI, REST job endpoints, CSV/JSON output, resume, concurrency controls, and browser pooling.
- Useful engineering ideas to independently implement: explicit job lifecycle, cancellation, resumable jobs, bounded concurrency, output adapters, health/status reporting, and CLI/API separation.
- Not suitable to reuse as a data source: its primary collector extracts Google Maps content. Google policy disallows exporting/extracting/scraping Maps content for use outside Maps services, including copying and saving business names and addresses.
- Decision: **REJECT as a collector and runtime dependency.** Study only generic job-management patterns. MIT license does not override Google's data terms.

### B. omkarcloud/google-maps-scraper
- Repository: https://github.com/omkarcloud/google-maps-scraper
- GitHub repository metadata reports MIT; active repository at review time.
- Source inspected: README and repository metadata.
- Observed product pattern: desktop-first guided workflow, keyword/location searches, business data enrichment, and a free-plan promotion. README advertises an application and monthly free-search allowance; those are vendor/product claims, not an unlimited open data guarantee.
- Useful ideas: guided search setup, progress visibility, clear result table, export-oriented workflow, and separating discovery from enrichment.
- Risks: same Google Maps extraction issue; free-plan limits and external hosted service are incompatible with RumiReach's no-required-paid-service principle; README claims are not independently benchmarked.
- Decision: **REJECT as a collector/runtime dependency.** Study workflow UX only.

### C. Scrapy
- Repository: https://github.com/scrapy/scrapy
- License reported by GitHub: BSD-3-Clause.
- Source inspected: official architecture document and item-pipeline documentation.
- Architecture: Engine coordinates a Scheduler, Downloader, Spiders, middleware, and sequential Item Pipelines. The pipeline is designed for cleansing, validation, and persistence; async networking supports concurrency.
- Useful patterns: separate request scheduling from fetching and parsing; use ordered validation stages; centralize retry/timeout/rate-limit policy; make parsing deterministic and testable; keep source-specific parsing isolated.
- Limitations for this project: full Scrapy would be unnecessary for the first small OSM API adapter; it is a framework rather than a business-data source and adds a separate runtime/dependency footprint.
- Decision: **DO NOT adopt Scrapy for MVP.** Reimplement a small, bounded request → parse → normalize → validate → persist pipeline. Re-evaluate only if future multi-domain crawling proves necessary.

### D. Crawl4AI
- Repository: https://github.com/unclecode/crawl4ai
- License reported by GitHub: Apache-2.0.
- Source inspected: project README/quickstart documentation and repository metadata.
- Observed capabilities: asynchronous crawler, browser-backed dynamic-page handling, configurable crawl/run settings, HTML-to-Markdown generation, CSS/XPath extraction, optional LLM extraction, streaming and adaptive crawling.
- Useful ideas for later website intelligence: separate browser/run configuration from extraction strategy; support deterministic CSS selectors before AI extraction; adaptive stopping; expose crawl statistics and confidence.
- Risks: browser automation is heavier than required for the first lead-discovery goal; LLM extraction can add nondeterminism and cost; crawling third-party websites still requires terms review and SSRF protections.
- Decision: **DO NOT adopt as MVP runtime dependency.** Independently implement the minimal website-check workflow later; consider generic browser tooling only after security review.

### E. Playwright
- Repository: https://github.com/microsoft/playwright
- License reported by GitHub: Apache-2.0.
- Source inspected: README and official usage overview.
- Observed capabilities: cross-browser automation, isolated contexts, resilient locators, auto-waiting, tracing, network interception, and mobile emulation.
- Useful ideas: isolated browser sessions, deterministic browser tests, traces on failure, and network request controls.
- Limitations: not a data source or crawler policy engine; a browser can access internal network targets unless the application applies strict egress and SSRF controls.
- Decision: **NOT required for Goal 1.** Consider it as a development/test tool or for later website audits, not as an assumed production dependency.

## Source-policy findings

### Google Maps
Official policy:
- https://developers.google.com/maps/faq
- https://developers.google.com/maps/documentation/places/web-service/policies
The policy says not to export, extract, or scrape Google Maps Content for use outside the services and specifically gives copying/saving business names and addresses as examples. Therefore RumiReach must not ingest Maps listing fields into its own lead database. A Google Maps URL entered independently by the operator is a different case and must not be populated by copying Maps content.

### OpenStreetMap and ODbL
Official copyright/licensing:
- https://www.openstreetmap.org/copyright
OSM data is available under ODbL. Attribution is required; distributing an adapted/derivative database may trigger share-alike obligations. Keep OSM-sourced records and field observations clearly identified, display attribution, and obtain legal review before distributing a combined or derived lead database. Do not assume that mixing datasets removes ODbL obligations.

### Overpass
- https://wiki.openstreetmap.org/wiki/Overpass_API
- https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
Public Overpass instances are shared community resources. Their own documentation warns against repeated identical requests, one-by-one element retrieval, bulk extraction, and using public instances as the backend for an app with many users. It describes rate limiting and HTTP 429 responses.
- RumiReach pilot policy: one bounded query per user-initiated job, no parallel requests, cache the raw permitted response, identify the client with a truthful User-Agent, honor 429/Retry-After, and stop on repeated failures. These are conservative product defaults, not a claim that any particular server guarantees service.
- If regular or commercial usage outgrows small manual testing, use a locally downloaded regional OSM extract or self-hosted Overpass. Self-hosting has hardware, disk, bandwidth, and maintenance costs, even if software is open-source.

## RumiReach-specific implementation plan

### Goal 1 source strategy
1. First adapter: OSM/Overpass, explicitly labelled OSM-derived.
2. Search tags: `amenity=restaurant` and relevant food-service tags; keep tag scope configurable and record the exact query.
3. Search geometry: use a reviewed locality boundary or operator-confirmed bounding box. Do not silently geocode arbitrary names through an unreviewed service.
4. Fields: OSM object type/id, name, cuisine/category tags, address tags, phone/contact tags, website/contact website tags, coordinates, source timestamp, query ID, and attribution.
5. Do not assume OSM's `phone` or `website` fields are complete. Empty means unknown/not contributed, not absent.
6. Store source object references and source timestamps; distinguish OSM-observed values from independently verified values.
7. Enrichment from a business-owned website is a later opt-in adapter and requires its own access/terms/retention policy.

### Pilot success criteria
- Can the source return a bounded, traceable sample for the chosen Gulshan-e-Iqbal area?
- How many objects are restaurants vs unrelated food venues?
- What proportion have name, address, phone, and website tags?
- How many are duplicates or malformed?
- Does the data quality justify building further enrichment?
The target of 50 is a test target, not a guaranteed result. If OSM coverage is too low, report the gap rather than silently switching to a prohibited source.

## Final recommendations

| Candidate | Study patterns | Adopt as Goal 1 runtime | Decision |
|---|---:|---:|---|
| gosom Google Maps Scraper | Yes | No | Reject collector |
| omkarcloud Google Maps Scraper | Yes | No | Reject collector |
| Scrapy | Yes | No | Reimplement small pipeline |
| Crawl4AI | Yes | No | Defer website audit |
| Playwright | Yes | No | Optional test/browser tool later |
| OSM/Overpass data | Yes | Pilot only | First source experiment, with limits |

## Important distinction
The user's instruction is to independently implement RumiReach's product behavior, not to transplant application repositories. Generic infrastructure libraries may still be considered separately, with a license/security review and an explicit decision. This audit does not grant permission to copy substantial code, assets, or distinctive UI from any candidate.
