# Initial Data Model

Logical model for MVP; exact SQL types and migrations are implementation tasks.

## Entities

### SearchJob
id, category, country_code (default PK), city, locality, target_count, selected_source_ids, status (queued/running/completed/partial/failed/cancelled), started_at, finished_at, request_count, candidate_count, error_count, error_summary.

### SourceRegistry
id, name, canonical_terms_url, policy_reviewed_at, policy_snapshot, permitted_use, prohibited_use, permitted_fields, attribution_text, rate_limit_policy, enabled, reviewer_notes.

### Candidate
id, search_job_id, source_id, source_record_ref, business_name, category, address_text, locality, city, country_code, phone_raw, phone_e164, website_raw, website_normalized, public_email, public_social_urls, source_url, observed_at, duplicate_group_id, review_status (pending/accepted/rejected/needs_review), rejection_reason, created_at, updated_at.

### Lead
id, canonical_business_name, category, address_text, locality, city, country_code, phone_raw, phone_e164, website_url, public_email, status (new/researching/qualified/contacted/replied/meeting/proposal/won/lost/do_not_contact), qualification_notes, created_at, updated_at, last_verified_at.

### FieldObservation
id, entity_type, entity_id, field_name, value, source_id (nullable for manual entry), source_record_ref, observed_at, verification_status (unverified/source_observed/manually_verified/invalid/unreachable/not_found/not_checked), verification_method, verified_at.

### Later-stage entities
ContactEvent: lead_id, channel, direction, event_type, message_summary, occurred_at, operator_notes.

ConsentRecord: lead_id, channel, purpose/category, consent_status (unknown/granted/withdrawn), consent_source, evidence_reference, granted_at, withdrawn_at, recorded_at.

SuppressionEntry: channel, normalized_contact, reason, created_at, source_event_id.

## Relationships
One SearchJob produces many Candidates. A SourceRegistry entry supplies many Candidates and observations. A Candidate may be promoted to one Lead. Leads have many observations and later contact/consent records. Suppression is checked before outreach.

## Integrity rules
- Preserve raw and normalized values.
- Phone and website are optional.
- Phone alone is not a guaranteed business identity.
- Ambiguous matches are not auto-merged.
- Latest observation must not silently replace a manually verified value.
- Use explicit unknown/not-checked states, not empty strings.
- Store timestamps in UTC; display in Asia/Karachi time.

## Duplicate strategy
Signals from strongest to weakest: exact normalized official domain; exact normalized phone; exact source ID within source; normalized business name plus locality/address similarity. A score creates a review suggestion, not an automatic merge. Chain branches may share numbers or domains.

## CSV headers
lead_id,business_name,category,address,locality,city,country,phone_raw,phone_e164,website_url,public_email,source_name,source_reference,observed_at,last_verified_at,verification_status,lead_status,notes

Use UTF-8 and standard CSV escaping.