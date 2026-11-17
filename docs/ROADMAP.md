# RumiReach Roadmap

Complete each phase's acceptance gate before starting the next.

## Phase 0 — Research and foundation
- [x] Confirm product name and repository.
- [x] Add initial PRD, architecture, data governance, data model, security, roadmap, development, testing, and research docs.
- [ ] Audit candidate open-source projects: algorithms, architecture, UX, license, risks, and limitations.
- [ ] Review source policies and endpoint limits.
- [ ] Confirm stack and local setup.
**Gate:** approved source plan, architecture, and implementation backlog.

## Phase 1 — Goal 1: discover and collect
- [ ] Scaffold local app and database migrations.
- [ ] Implement source registry and adapter contract.
- [ ] Implement first permitted discovery adapter.
- [ ] Add bounded jobs, progress, cancellation, and logs.
- [ ] Add candidate review and source provenance.
- [ ] Add phone normalization and website URL validation.
- [ ] Add duplicate suggestions and manual review.
- [ ] Add lead promotion, filtering, and CSV export.
- [ ] Run pilot: target 50 restaurants in Gulshan-e-Iqbal, Karachi.
- [ ] Produce coverage, accuracy, freshness, and duplicate report.
**Gate:** P0 acceptance passes and all source use is approved.

## Phase 2 — Goal 2: compliant outreach
- [ ] Qualification filters and draft templates.
- [ ] Click-to-chat link generation.
- [ ] Consent evidence, purpose scope, opt-out, and suppression.
- [ ] Human approval and activity history.
**Gate:** policy review and consent/suppression tests pass. No automated sending by default.

## Phase 3 — Goal 3: website intelligence
- [ ] Safe reachability and HTTPS checks.
- [ ] Mobile, performance, SEO, and accessibility signals.
- [ ] Contact/menu/booking/order-path detection.
- [ ] Technology signals with confidence levels.
- [ ] Evidence-backed service opportunity report.
- [ ] SSRF and malicious-page security tests.
**Gate:** findings are reproducible, confidence-labelled, and safe.

## Phase 4 — Goal 4: CRM
- [ ] Pipeline stages and lead ownership.
- [ ] Contact history and reminders.
- [ ] Proposal/quote tracking.
- [ ] Outcome/revenue reporting.
- [ ] Backup, restore, and retention.
**Gate:** end-to-end sales workflow tested.

## Phase 5 — optional expansion
- [ ] More categories, cities, and approved sources.
- [ ] PostgreSQL option when scale requires it.
- [ ] Multi-user only after authentication/authorization design.
- [ ] Remote deployment only after cost, privacy, and security review.

## Scope discipline
Do not add AI, automation, cloud hosting, or complex integrations without a measured need. Keep such capabilities optional and preserve the zero-subscription MVP goal.