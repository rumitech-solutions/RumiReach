# Requirements Traceability Matrix

This matrix links product requirements to design areas and planned verification. Test file paths will be filled in when the implementation stack is selected.

| Requirement | Design area | Verification |
|---|---|---|
| FR-001 Search by category/city/locality | Search orchestration | Search input and job integration tests |
| FR-002 Source policy declaration | Source registry/adapter | Policy guard tests; source review checklist |
| FR-003 Source reference and timestamp | Candidate/provenance | Persistence tests |
| FR-004 Candidate review | Candidate workflow | Accept/reject/merge integration tests |
| FR-005 Missing data remains unknown | Normalization | Null/unknown-state unit tests |
| FR-006 Pakistani phone normalization | Validation | Valid/invalid/ambiguous number tests |
| FR-007 Website validation | Safe URL checker | URL and SSRF security tests |
| FR-008 Duplicate suggestions | Deduplication | Exact and fuzzy match tests |
| FR-009 Search/filter/export | Lead and export modules | CSV round-trip tests |
| FR-010 Collection/verification timestamps | Provenance | Persistence and timezone tests |
| FR-011 Protect manually verified values | Field observations | Re-import regression tests |
| FR-012 Provenance history | Field observations | History query tests |
| FR-013 Do-not-contact/opt-out | Consent/suppression | Suppression tests |
| FR-014 Human-reviewed drafts | Outreach workspace | Draft workflow tests |
| FR-015 Website audit report | Website intelligence | Reproducibility and security tests |

## Change control
When a requirement changes, update the PRD, this matrix, roadmap, and relevant tests in the same pull request. Requirements removed from scope should be marked deferred or rejected with rationale, not silently deleted.