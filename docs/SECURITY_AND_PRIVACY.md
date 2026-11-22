# Security & Privacy Baseline

## 1. Objectives
Protect local lead data, prevent unsafe network access, keep secrets out of source control, and prevent misuse for spam or invasive personal-data collection.

## 2. Data classification
- Public business data: business-published details; still subject to terms and privacy law.
- Internal sales data: notes, qualification, pipeline, contact history.
- Restricted: credentials, tokens, consent evidence, exports, backups.
- Prohibited: sensitive personal data, private/home contact details, credentials, and data obtained by bypassing access controls.

## 3. Required controls
- Bind local server to 127.0.0.1 by default.
- Do not expose dashboard to LAN/public internet without authentication and security review.
- Store secrets in environment variables or OS credential store; commit placeholders only.
- Ignore local databases, logs, exports, backups, and profiles in Git.
- Validate inputs, encode output, and use parameterized SQL.
- Apply timeouts, response-size limits, redirect caps, and per-source rate limits.
- Restrict outbound checks to public IPs and defend against DNS rebinding/SSRF.
- Sanitize logs; avoid unnecessary contact/message data.
- Provide delete/export and backup/restore controls.
- Review dependency updates and licenses.

## 4. Website audit threat model
User-supplied URLs may target localhost, private networks, cloud metadata, redirect chains, DNS rebinding, oversized responses, or malicious content. Accept HTTP(S) only; resolve and reject private/reserved ranges; validate each redirect and resolved IP; cap ports, redirects, bytes, duration, and concurrency; never execute downloaded files; sandbox browser rendering with strict egress controls.

## 5. Outreach abuse prevention
No unsolicited messaging or unattended campaign blasts. WAHA sends are paced, capped per day and de-duplicated per contact. Check opt-out/suppression first. Require per-message operator confirmation and audit contact, timestamp, channel, and consent evidence. Enforce local cooldown and daily limits. A public phone number is not consent. WAHA is an unofficial WhatsApp Web integration and can result in account restrictions; use the official Meta Cloud API for supported business messaging.

## 6. Incident response
Disable affected source/feature, stop jobs, revoke exposed credentials, preserve minimal evidence, identify affected records/exports, delete or correct data as required, add regression tests, and document approval before re-enabling.

## 7. Release gate
Do not release with committed secrets, tracked local data, failing SSRF tests, undocumented source policy, or outreach that bypasses consent/suppression.