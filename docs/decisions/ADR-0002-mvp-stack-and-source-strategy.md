# ADR-0002: MVP stack and first discovery source

- Status: accepted
- Date: 2026-11-17
- Owner: RumiTech Solutions

## Context
RumiReach is a local-first Windows application. The first deliverable is business discovery and lead review, not a general web scraper. The repository audit found useful generic patterns but no researched collector is suitable as the RumiReach production data source.

## Decisions

### Application stack
- React + TypeScript + Vite for the local dashboard.
- Fastify + TypeScript for the local API.
- Zod for shared request/response validation.
- SQLite via better-sqlite3 with versioned SQL migrations.
- Vitest for unit and integration tests.
- npm workspaces to keep setup straightforward on Windows.

### Data-source strategy
- First source experiment: OpenStreetMap via Overpass, subject to ODbL, attribution, service policy, and conservative request limits.
- The initial search uses a reviewed boundary or operator-confirmed bounding box; no implicit third-party geocoder.
- Google Maps extraction is explicitly excluded.
- Business-owned websites may be considered later as a separate source adapter after terms and safe-crawling review.

### Research policy
- Scrapy, Crawl4AI, Playwright, and the two Google Maps scraper repositories remain research references, not application product dependencies.
- RumiReach product logic, data model, UX, and source adapter will be implemented independently.
- Generic libraries are evaluated separately for license, security, maintenance, and necessity.

## Consequences
Benefits: TypeScript across UI and API, straightforward local Windows development, no paid API required for core MVP, clear source boundaries, and a small dependency footprint.

Trade-offs: SQLite is single-user oriented; Overpass public service availability is not guaranteed; OSM coverage for phone and website fields may be low; ODbL obligations need review before distributing a derived dataset.

## Rejected alternatives
- Google Maps scraper projects: source terms prevent exporting/storing copied Maps content outside Google services.
- Scrapy/Crawl4AI as MVP core: excessive for one bounded OSM query and introduces general crawling complexity.
- Cloud-first backend: unnecessary cost and data exposure for the first internal single-user pilot.
