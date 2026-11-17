# Development Guide

## Current state
This repository currently contains the documentation baseline. The implementation stack and commands will be finalized in the first implementation change. Do not assume build commands exist before scaffold files are committed.

## Development rules
- Read the PRD and source governance before implementing collectors.
- Implement original RumiReach modules; research other repositories for ideas, not runtime dependence.
- Keep source adapters isolated from business logic.
- Every external field needs provenance.
- Core discovery and validation must work without AI.
- Avoid paid APIs and subscriptions in MVP.
- Never commit secrets, databases, exports, logs, or personal data.
- Add tests with each feature.
- Update docs and ADRs when architecture or policy changes.

## Branch naming
- docs/topic
- feat/short-description
- fix/short-description
- test/short-description

## Commit prefixes
docs:, feat:, fix:, test:, refactor:, chore:.

## Definition of done
Acceptance criteria met; tests pass; source terms and data handling reviewed; errors handled; no secrets/local data committed; docs updated; security implications reviewed; clean-checkout setup reproducible.

## Environment
Use an example environment file with placeholders only. Keep local data outside the repository, in the user's application data directory.

## Pull request checklist
- [ ] Linked requirement or issue.
- [ ] Scope and acceptance criteria are clear.
- [ ] Tests added/updated and passing.
- [ ] Source policy reviewed for collection changes.
- [ ] Provenance and retention documented.
- [ ] Security/privacy reviewed.
- [ ] No secrets, database, exports, or logs included.
- [ ] User-facing docs updated.