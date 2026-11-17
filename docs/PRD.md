# Product Requirements Document

- Product: RumiReach
- Tagline: Discover. Qualify. Connect.
- Owner: RumiTech Solutions
- Version: 0.2 — source audit and stack decision
- Date: 2026-11-17
- Status: implementation baseline

## 1. Vision
Build a local-first client acquisition platform that helps RumiTech Solutions discover potential business clients, organize trustworthy public business information, understand each business's digital presence, and manage compliant, human-reviewed outreach.

RumiReach is an internal sales productivity tool first—not a public business directory, contact-harvesting service, or messaging blaster.

## 2. Problem
Business research requires repetitive manual searches across directories, maps, websites, and social profiles. Data is fragmented, duplicated, incomplete, and quickly stale. Sales research and follow-up are difficult to track.

## 3. Goals and success measures

### Goal 1 — Discover and collect (MVP)
Search by category, city, and locality; discover candidate businesses from permitted sources; review and save structured records.

Pilot: target 50 unique restaurants in Gulshan-e-Iqbal, Karachi.

Measure candidate count, unique accepted leads, usable public phone coverage, website URL coverage, traceable-source coverage, duplicate rate, freshness, manual verification rate, and time per accepted lead. Do not promise a minimum coverage rate before the pilot.

### Goal 2 — Outreach workspace (later)
Filter qualified leads, prepare personalized drafts, create click-to-chat links, and track replies/follow-ups. Consent evidence and opt-out suppression are mandatory. No automated bulk sending in MVP.

### Goal 3 — Website intelligence (later)
Check availability, HTTPS, mobile usability, performance, basic SEO/accessibility, contact/order paths, and technology signals. Recommendations must cite observable evidence and confidence.

### Goal 4 — Sales CRM (later)
Track lead stages, contact history, follow-up dates, proposals, outcomes, and revenue.

## 4. Primary user
A RumiTech Solutions operator using a Windows desktop.

## 5. MVP scope
- Local-first, single-user dashboard.
- Search configuration: category, city, locality, target count, selected sources.
- Source adapter interface with terms, attribution, permitted fields, and rate limits.
- First discovery experiment: OSM/Overpass, only within its permitted usage and ODbL obligations.
- Operator-confirmed locality boundary or bounding box for the first pilot; no hidden geocoding provider.
- Candidate staging and human approval before promotion to leads.
- Business name, category, address/locality, public phone, website, business-published email/social links where permitted, source reference, source type, observed date, verification status, notes.
- Pakistani phone normalization to E.164 when unambiguous; preserve raw input.
- Website URL syntax validation in Goal 1; active website reachability checks are a separate, security-reviewed feature.
- Duplicate suggestions using normalized phone/domain and conservative name/location matching.
- CSV export, quality metrics, and error reporting.

## 6. Out of scope
- Google Maps scraping or storing copied Maps content.
- Automated WhatsApp sending or contact-list blasting.
- Paid APIs/subscriptions as required MVP dependencies.
- AI dependency for core discovery, validation, or deduplication.
- Multi-tenant SaaS, billing, public lead marketplace.
- Claims that a business lacks POS, CRM, inventory, or ordering software without verification.
- Collection of personal profiles or sensitive personal data.
- General-purpose web crawling in the first Goal 1 release.

## 7. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Search by category, city, and locality | P0 |
| FR-002 | Each source declares terms, permitted fields, attribution, and limits | P0 |
| FR-003 | Candidate records retain source reference and timestamp | P0 |
| FR-004 | User can accept, reject, merge, or flag candidates | P0 |
| FR-005 | Missing values remain unknown; never fabricate | P0 |
| FR-006 | Normalize Pakistani phones while preserving raw input | P0 |
| FR-007 | Validate website URL syntax and schemes | P0 |
| FR-008 | Detect likely duplicates; ambiguous matches require review | P0 |
| FR-009 | Search, filter, sort, and export leads to CSV | P0 |
| FR-010 | Record collection/verification timestamps and source base timestamp | P0 |
| FR-011 | Re-runs do not overwrite manually verified values silently | P0 |
| FR-012 | Field-level provenance history | P1 |
| FR-013 | Do-not-contact and opt-out status | P1 |
| FR-014 | Human-reviewed outreach drafts | P2 |
| FR-015 | Website audit and evidence-backed opportunity report | P2 |

## 8. Data quality rules
- Preserve raw and normalized values separately.
- Distinguish not checked, not found, invalid, unreachable, source-observed, and manually verified.
- A failed website request does not prove no website exists.
- Missing website data in one source does not prove absence.
- Technology detection is a signal, not proof of internal software.
- Website analysis cannot reliably prove POS absence; verify directly with the business.
- Every imported lead must have a traceable source reference and collection timestamp.

## 9. Non-functional requirements
- Windows setup with reproducible npm commands.
- Core MVP works without paid API credentials.
- SQLite with versioned migrations; migrations must permit future PostgreSQL.
- No secrets or lead data committed to Git.
- Network collection is bounded, rate-limited, observable, and cancellable.
- Local API binds to 127.0.0.1 by default.
- Portable exports and documented backups.
- Tests cover parsing, normalization, deduplication, source rules, and exports.

## 10. User workflow
1. Configure category, city, locality, and target count.
2. Select an enabled source and review its rules.
3. Run a bounded discovery job.
4. Inspect candidates and provenance.
5. Resolve duplicates and verify key fields.
6. Approve records into leads.
7. Export CSV and review the quality report.

## 11. Pilot acceptance
- User can run the restaurant search for Gulshan-e-Iqbal, Karachi.
- Every imported lead has a traceable source and collection timestamp.
- Incomplete records are retained without fabricated fields.
- Duplicates are detected or flagged for review.
- Phone and website statuses are explicit.
- CSV opens correctly in spreadsheet software.
- Quality report shows actual coverage and duplicate rates.
- No prohibited Google Maps extraction or automated WhatsApp sending.
- All P0 tests pass and Windows setup works.

The 50-record goal is a sample target, not a guarantee from any source. If OSM does not yield 50 suitable records, RumiReach must report the measured gap; it must not silently switch to a prohibited source.

## 12. Risks and assumptions
Open datasets may be incomplete or stale; public Overpass instances are shared and can throttle or deny requests; provider rules and formats change; public search results are not automatically free-to-scrape; local law may impose additional restrictions; zero subscription cost does not mean unlimited throughput.

## 13. Decisions
- Stack: React + TypeScript + Vite, Fastify API, SQLite (better-sqlite3), Zod, Vitest.
- First source experiment: OSM/Overpass with attribution and ODbL review.
- No Google Maps extraction.
- Repository license remains to be selected.
- Retention periods for rejected/stale records must be decided before production use.
