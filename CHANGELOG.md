# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Release Notes Workflow

### Ownership and Process

**Changelog Owner**: Project maintainers are responsible for reviewing and finalizing release-please pull requests before each release.

**Contributor Workflow**:

1. **During development**: Use Conventional Commit messages for every commit.
2. **Before PR**: Select the PR commit type and flag breaking changes in the PR template when applicable.
3. **PR review**: Commitlint validates PR commit messages in CI.
4. **Release preparation**: release-please opens or updates a release PR after changes merge to `main`.

### Automated Collection

The project uses release-please to automatically generate changelog entries from commit messages and update `CHANGELOG.md` on release PRs.

**Commit Message Format** (follows [Conventional Commits](https://conventionalcommits.org/)):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Examples**:

- `feat(api): add portfolio export endpoint`
- `fix(auth): resolve JWT token expiration handling`
- `perf(worker): reduce rebalance polling load`
- `docs: update API client examples`
- `chore(deps): update stellar-sdk to v12.0.1`
- `feat(api)!: require signed export requests`

Use a `!` after the type/scope or add a `BREAKING CHANGE:` footer when a commit introduces a breaking change. release-please flags those entries in the generated changelog.

### Entry Categories

Release changelog entries are generated into these sections:

- **Features**: New features and capabilities from `feat`
- **Bug Fixes**: Bug fixes from `fix`
- **Performance**: Performance improvements from `perf`
- **Breaking Changes**: Breaking changes flagged with `!` or `BREAKING CHANGE:`

### Release Publication

**Pre-release checklist**:

1. Confirm the release-please PR was generated from the intended commits.
2. Confirm the proposed version follows [semantic versioning](https://semver.org/).
3. Review the generated `CHANGELOG.md` sections for clarity.
4. Confirm breaking changes are clearly documented.
5. Add migration guides for major changes when needed.

**Release process**:

1. Merge conventional commits to `main`.
2. Let release-please create or update the release PR.
3. Review the generated version bump and `CHANGELOG.md` updates.
4. Merge the release PR when ready.
5. release-please creates the GitHub release and tag from the merged release PR.

### Maintenance Guidelines

**For contributors**:

- Use clear conventional commit subjects for user-facing changes.
- Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
- Reference issue/PR numbers in PR descriptions.
- Keep related work grouped into reviewable commits when practical.

**For maintainers**:

- Review generated changelog entries in release-please PRs
- Ensure breaking changes are prominently documented
- Maintain consistent formatting and tone
- Archive old versions (keep last 2 major versions visible)

**Quality standards**:

- Entries should be understandable to end users
- Technical implementation details belong in commit messages, not changelog
- Focus on impact and behavior changes
- Include migration steps for breaking changes

### Cross-references

- **API changes**: Link to [API.md](API.md) for endpoint documentation
- **Setup changes**: Reference [CONTRIBUTING.md](CONTRIBUTING.md) for new requirements
- **Breaking changes**: Include migration guides in release notes
- **Security updates**: Follow [security disclosure policy](.github/SECURITY.md) if applicable

## [Unreleased]

### Added

- GitHub Actions build attestations for frontend and backend release bundles, plus CycloneDX SBOM artifacts for frontend, backend, and contracts.
- A repository-level npm audit baseline and CI policy gate, with a backend-local wrapper command for maintainers.
- A reusable release checklist template for contract, backend, and frontend releases, together with a contract Makefile helper that points to it.
- Replay-focused idempotency tests for cached success/error responses, cross-user key rejection, and expiry cleanup paths.
- WebSocket integration tests for `portfolio_update` message shape, reconnect behavior, and per-user event isolation.
- Feature-flag test coverage for env parsing, runtime toggles, fail-safe defaults, and startup logging visibility.
- Project-level changelog automation script using `conventional-changelog-cli`.
- CI commit message lint that enforces Conventional Commits on pull requests, with a locally runnable `scripts/check-commit-messages.sh` helper and contributor documentation.
- commitlint-based PR commit validation, release-please changelog release automation, and a PR template commit type selector.
- Sharded backend test execution in CI (4 parallel shards with merged coverage and threshold enforcement) plus `test:shard`/`test:merge-coverage` scripts and contributor docs for reproducing it locally.
- Portable health smoke script (`scripts/health-smoke.sh`, `npm run smoke`) that probes `/health`, `/api/health`, `/ready`, and `/metrics` across local/staging/prod with a clear pass/fail summary, documented in OPERATIONS.md and API.md.
- Tightened generated-artifact guard: `backend/openapi.json` freshness is now verified by regenerating from source and diffing (replacing a heuristic that referenced a non-existent spec path), wired into the Generated Artifact Guard workflow and documented in backend/docs/openapi.md.

## [1.3.0] - 2026-04-27

### Added

- Soroban contract hardening and benchmark coverage for emergency controls, pricing edges, allocation limits, and gas baselines.
- Documentation updates for environment setup, contract ABI usage, and realtime subsystem behavior.

### Changed

- Contract-facing validation and diagnostics coverage for backend/frontend integration paths.

## [1.2.0] - 2026-03-20

### Added

- Legal consent workflow and privacy controls including GDPR export/delete support.
- Portfolio export coverage across JSON/CSV/PDF flows with ownership and access checks.

### Changed

- API validation and consent enforcement to keep privacy-related operations auditable and policy-driven.

## [1.1.0] - 2026-03-18

### Added

- Wallet-signed challenge authentication flow with token refresh and logout lifecycle.
- JWT-protected endpoint coverage and end-to-end auth integration tests.

### Changed

- Replaced address-only login behavior with stronger signature-based auth and ownership enforcement.
