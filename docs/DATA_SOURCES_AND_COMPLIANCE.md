# Data Sources, Licensing & Compliance

This is an engineering safeguard, not legal advice. Review current terms and applicable Pakistan law before enabling any source.

## 1. Source admission checklist
Before enabling a source, document its publisher, canonical terms/license URL, automated access permission for intended use, commercial/internal use, permitted fields and purposes, attribution, retention/caching/redistribution rules, rate limits, review date, and disable procedure.

Robots.txt is not a license or permission grant. Public visibility alone does not authorize scraping or reuse.

## 2. Initial source hierarchy

### OpenStreetMap
Potentially useful open data, subject to ODbL and service policies. Coverage varies by locality; phone and website tags may be absent.

Requirements:
- Attribute OpenStreetMap and contributors as required.
- Review ODbL obligations, including share-alike implications for a derivative database.
- Respect Overpass endpoint usage policies, rate limits, and caching guidance.
- Do not assume public Overpass servers offer unlimited free production use.
- Keep OSM-derived records identifiable for licensing review.

References:
- https://www.openstreetmap.org/copyright
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- https://operations.osmfoundation.org/policies/overpass/

### Business-owned websites
May provide business-published details. Use low-volume requests, respect terms and access controls, and collect only relevant public business information. Never bypass authentication, CAPTCHAs, paywalls, or technical restrictions.

### Search engines and directories
Do not assume result pages are free-to-scrape datasets. Review each provider's terms and API conditions before automation. A public page is not automatically an approved data feed.

### Google Maps / Google Maps Platform
Do not build a Google Maps scraper or copy Maps business names, addresses, phones, websites, reviews, or other Maps content into RumiReach. Google terms prohibit exporting, extracting, or scraping Maps content for use outside the services, including copying and saving business names and addresses. Use Google Maps only in ways permitted by current terms.

References:
- https://developers.google.com/maps/faq
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://cloud.google.com/maps-platform/terms

### Social networks
Do not scrape personal profiles or bypass platform restrictions. Use official APIs only where intended access and use are permitted. Prefer business-owned channels.

## 3. Field-level provenance
Every externally sourced field must record source ID/reference, observed timestamp, retrieval method, policy/license version, and verification status. Manual edits must be marked as user-entered. Keep observations/history rather than silently overwriting.

## 4. Data minimization
Collect business name/category, appropriate business location, public business phone, official website, business-published email/social links where permitted, source references, and verification notes. Do not collect sensitive personal data, private contact details, home addresses, or unrelated personal profiles.

## 5. WhatsApp safeguards
A publicly listed phone number is not consent to WhatsApp marketing. Before business-initiated messaging:
- Obtain opt-in for the relevant message category and identify the business.
- Store consent source, timestamp, scope, and evidence.
- Provide clear opt-out and honor it.
- Maintain a suppression list.
- Use approved templates where platform rules require them.
- Require human review.
- Never automate unsolicited bulk messaging or use unofficial WhatsApp Web automation as a workaround.

Policy: https://whatsappbusiness.com/policy/

Outreach remains disabled until these controls are implemented and reviewed.

## 6. Retention and deletion
Define retention before production. Delete rejected/stale records under the approved policy. Provide export and deletion workflows. Source-specific retention restrictions take precedence. Backups follow the same retention controls.

## 7. Source registry fields
source_id, source_name, canonical_terms_url, policy_reviewed_at, permitted_use, prohibited_use, permitted_fields, attribution, retention_rule, rate_limit, enabled, reviewer_notes.

## 8. Stop conditions
Disable a source if terms change, access is challenged, rate limits are ignored, attribution cannot be maintained, provenance is lost, or permission for intended use cannot be established.