# Open-source Research & Independent Implementation

## Purpose
Study open-source projects to learn architecture, algorithms, UX, reliability, and testing practices. Build an independently designed implementation for RumiReach.

Researching a repository does not authorize copying its code or making it a runtime dependency.

## Candidate areas and examples
- Business discovery and map-data research.
- OSM/Overpass clients.
- Web crawling and website auditing.
- URL/phone normalization and duplicate resolution.
- CRM lead review UX.

Research candidates (not approved runtime dependencies):
- https://github.com/gosom/google-maps-scraper
- https://github.com/omkarcloud/google-maps-scraper
- https://github.com/Mahanaicoach/google-maps-scraper-kit
- https://github.com/unclecode/crawl4ai
- https://github.com/scrapy/scrapy
- https://github.com/microsoft/playwright
- https://github.com/GoogleChrome/lighthouse

These are not endorsements and must not be used to scrape restricted sources. A repository license never overrides a data provider's terms.

## Required research record
For each project record repository URL and exact commit/tag; license and obligations; maintenance health; architecture/modules; relevant algorithms and UX patterns; strengths/weaknesses; performance/security risks; source-provider compliance; what can be independently implemented; what must not be copied or relied upon; and decision.

Do not use star count as the primary quality measure.

## Independent workflow
1. Read docs and inspect relevant source.
2. Describe behavior and concepts in original words.
3. Compare against RumiReach requirements.
4. Design RumiReach-specific interfaces and data model.
5. Implement original code and tests.
6. Review license/attribution before any code or asset reuse.
7. Record decisions in an ADR.

Do not copy substantial code, distinctive UI, assets, or documentation. Stop for license review before reusing snippets.

## Infrastructure vs product dependencies
The user preference is to avoid depending on researched repositories as application products/runtime services. Generic frameworks and libraries may be proposed separately, with justification, license review, and approval.

## Research report template
Project/URL/commit; license; purpose; architecture; useful ideas; risks; source compliance; RumiReach adaptation; decision (reject/investigate/approve generic library).