# ADR-0001: Local-first MVP and mandatory source provenance

- Status: accepted initial direction
- Date: 2026-11-17
- Owner: RumiTech Solutions

## Context
RumiReach targets a zero-subscription-cost MVP for a single Windows operator. Business data can come from sources with different licenses, retention rules, and permitted uses.

## Decision
1. Build the first version as a local-first application.
2. Use a modular monolith, not microservices.
3. Propose SQLite for the first single-user version, subject to stack confirmation.
4. Require a source registry and field-level provenance for external values.
5. Gate every source behind documented terms, permitted fields, attribution, rate limits, and retention.
6. Keep AI and outreach optional and outside Goal 1's critical path.
7. Research open-source projects for patterns; independently implement RumiReach product logic.
8. Do not scrape/export Google Maps content into the RumiReach database.

## Consequences
Benefits: no required hosted database or paid API; simpler setup; portable data; clear provenance; centralized source controls.

Trade-offs: operator manages backups; SQLite may need migration at scale; open-data coverage may be incomplete; website checks require SSRF protections.

## Rejected alternatives
Cloud-first SaaS adds hosting/security/recurring costs before validation. Microservices add unnecessary complexity. Google Maps scraping conflicts with documented restrictions on extracting and storing Maps content outside Google services.