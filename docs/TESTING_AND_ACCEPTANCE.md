# Testing Strategy & Acceptance

## 1. Test layers

### Unit
Phone parsing/normalization; URL normalization/validation; source normalization; duplicate scoring; CSV escaping/encoding; status transitions; provenance history.

### Integration
Clean database migrations; search job lifecycle/cancellation; source adapter contract and policy guard; candidate review/promotion; re-import without overwriting manually verified values; CSV export/import round trip.

### Security
SSRF to localhost/private/link-local/reserved IPs; DNS rebinding and redirect-to-private; oversized/slow responses; malformed URLs/non-HTTP schemes; SQL injection and XSS; secret leakage; outreach blocked for unknown/withdrawn consent or suppressed contact.

### Manual acceptance
Clean Windows setup; run pilot; inspect source references/timestamps; manually verify sample phones/sites; open CSV in Excel/LibreOffice; restore backup into a clean database.

## 2. Quality states
- not_checked: no check attempted.
- source_observed: value appeared in permitted source.
- manually_verified: operator independently confirmed it.
- invalid: failed validation.
- unreachable: attempted request did not reach a usable response.
- not_found: a defined search found no value; this does not prove it does not exist.

Do not collapse these into a boolean.

## 3. Pilot report
Include search criteria/source/time; candidate and unique accepted counts; phone coverage and validity; website coverage and reachability; duplicate suggestions/confirmed/unresolved; records missing both phone and website; manual verification sample/error rate; rate-limit/errors; source gaps.

## 4. MVP release gate
All P0 requirements pass; no prohibited source enabled; every lead has provenance; duplicates are reviewable; export is correct; SSRF tests pass before website checks; security/privacy checklist passes; setup and backup/restore verified.