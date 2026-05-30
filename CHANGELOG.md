# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Release Notes Workflow

### Ownership and Process

**Changelog Owner**: Project maintainers are responsible for reviewing and finalizing release notes before each release.

**Contributor Workflow**:

1. **During development**: Add entries to `## [Unreleased]` section when making user-facing changes
2. **Before PR**: Run `npm run changelog:update` to auto-generate entries from conventional commits
3. **PR review**: Maintainers review changelog entries for clarity and completeness
4. **Release preparation**: Maintainers move entries from `[Unreleased]` to a new version section

### Automated Collection

The project uses [conventional-changelog-cli](https://github.com/conventional-changelog/conventional-changelog) to automatically generate changelog entries from commit messages:

```bash
# Generate changelog entries from commits
npm run changelog:update

# Preview changes without writing
npm run changelog:preview
```

**Commit Message Format** (follows [Conventional Commits](https://conventionalcommits.org/)):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Examples**:

- `feat(api): add portfolio export endpoint`
- `fix(auth): resolve JWT token expiration handling`
- `docs: update API client examples`
- `chore(deps): update stellar-sdk to v12.0.1`

### Entry Categories

Changelog entries are organized by impact:

- **Added**: New features and capabilities
- **Changed**: Changes to existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Features removed in this version
- **Fixed**: Bug fixes
- **Security**: Security-related changes

### Release Publication

**Pre-release checklist**:

1. ✅ All `[Unreleased]` entries reviewed and categorized
2. ✅ Version number follows [semantic versioning](https://semver.org/)
3. ✅ Release date added in ISO format (YYYY-MM-DD)
4. ✅ Breaking changes clearly documented
5. ✅ Migration guides provided for major changes

**Release process**:

1. Create release branch: `git checkout -b release/v1.4.0`
2. Move `[Unreleased]` entries to new version section
3. Update version in `package.json` files
4. Commit changes: `git commit -m "chore: prepare release v1.4.0"`
5. Create PR for release branch
6. After merge, tag release: `git tag v1.4.0`
7. Push tag: `git push origin v1.4.0`

### Maintenance Guidelines

**For contributors**:

- Include changelog entries for user-facing changes
- Use clear, non-technical language when possible
- Reference issue/PR numbers: `(#123)`
- Group related changes under single entries when appropriate

**For maintainers**:

- Review changelog entries during PR review
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

- Replay-focused idempotency tests for cached success/error responses, cross-user key rejection, and expiry cleanup paths.
- WebSocket integration tests for `portfolio_update` message shape, reconnect behavior, and per-user event isolation.
- Feature-flag test coverage for env parsing, runtime toggles, fail-safe defaults, and startup logging visibility.
- Project-level changelog automation script using `conventional-changelog-cli`.
- CI commit message lint that enforces Conventional Commits on pull requests, with a locally runnable `scripts/check-commit-messages.sh` helper and contributor documentation.
- Sharded backend test execution in CI (4 parallel shards with merged coverage and threshold enforcement) plus `test:shard`/`test:merge-coverage` scripts and contributor docs for reproducing it locally.

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
