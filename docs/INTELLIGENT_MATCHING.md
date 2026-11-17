# Intelligent Business Identity Matching

RumiReach groups source records into unified business profiles automatically when deterministic evidence is strong enough. It does not require a person to approve every match, and it does not discard the original records.

## Current matching signals

- Pakistani phone normalization: strips formatting and converts common +92 / 0092 / local mobile formats to a comparable representation.
- Website hostname normalization: ignores scheme, path, query, case, and a leading www; social-network profile domains are excluded.
- Business-name similarity: Unicode-aware normalized token overlap is supporting evidence, never sufficient by itself.
- Address compatibility: conflicting known addresses block an automatic merge. This is a conservative text comparison, not geocoding.
- Branch protection: explicit branch/location conflicts block merging. A shared website domain alone cannot merge two branches when phone or address identity is missing.

## Automatic merge rules (current MVP)

1. Exact normalized phone + name similarity of at least 0.60 + no address/branch conflict: automatic merge.
2. Exact website domain + name similarity of at least 0.80 + either the same normalized phone or both records having compatible addresses: automatic merge.
3. Similar name, same category, or address text alone: never an automatic merge.
4. Unmatched or ambiguous records receive their own profile. A later incoming source record is evaluated against existing profiles.

These are deterministic confidence rules, not an AI model. The engine records a confidence score and machine-readable reasons for every automatic link. Thresholds should be tuned against a labelled Pakistan business dataset before broad production use.

## Data safety

- Original `candidates` rows remain intact as source records.
- `business_profiles` stores the unified identity view.
- `business_profile_sources` links every source record to its profile.
- `merge_history` records the automatic decision, score, evidence reasons, and time.
- Field observations remain attached to original source records; profile fields are a convenience summary and do not overwrite provenance.
- Conflicting source observations are not silently treated as verified truth.

The current MVP does not yet provide a merge rollback UI or full reversible split workflow. Those are required before bulk production consolidation.

## AI strategy

An API key is **not required** for the current identity matching engine. Deterministic phone, domain, name, and address evidence is cheaper, explainable, repeatable, and safer for identity decisions.

An optional OpenAI-compatible API integration can later assist with:
- website content classification and business service-fit analysis;
- lead qualification explanations and suggested RumiTech service opportunities;
- extracting structured public business facts from permitted business-owned pages;
- drafting personalized outreach for a human to review.

AI must not invent missing phone/email/contact details, claim a business is verified, or independently merge records based only on an LLM judgement. Provider keys must stay server-side in environment variables or a local secrets store, never in the browser bundle, SQLite exports, Git history, or logs. AI requests should be opt-in per feature, with provider/model, timestamp, prompt version, and source URLs retained.

## Remaining work

- Merge rollback and split/reassign workflow.
- Better address normalization and geospatial comparison when source coordinates are stored.
- A labelled evaluation dataset, precision/recall reporting, and configurable thresholds.
- Optional server-side AI provider settings and lead scoring.
- Unified profile detail page with complete provenance and conflict views.
