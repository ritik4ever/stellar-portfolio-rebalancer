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

## [1.4.0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/compare/stellar-portfolio-rebalancer-v1.3.0...stellar-portfolio-rebalancer-v1.4.0) (2026-07-01)


### Features

* [#428](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/428) Support daily and weekly notification digest modes ([4c9068b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4c9068b09bf0273ed6f62ca51b6f7386f441d8a6))
* **#467:** Attach deprecation headers and docs links to legacy route aliases ([4e426aa](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4e426aa12e6c459c7f046c551736ab09aa86d02c))
* **#487:** show stale/fallback price badges on asset cards ([30057fa](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/30057faf5105e556d831cd8459a1a0966b533a9e))
* **#487:** show stale/fallback price badges on asset cards ([7fba4d0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7fba4d021048c5255e5fb827afa3235be6a5e9b6)), closes [#487](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/487)
* add 4 components for open source contributions ([609cb46](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/609cb4609f341f0b2b1db7111daaf29670ad0e90))
* add 4 components for open source contributions ([a83a3bb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a83a3bb5d3b260ab71081322a5ae5daafe39121d))
* add 5-step PortfolioWizard page ([#998](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/998)) ([e1bb078](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e1bb0784ca9947a4e0117af27caf76317f641969))
* add 5-step PortfolioWizard page (closes [#998](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/998)) ([142e292](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/142e2926ad7a63eaf57bc3653f242a807403868e))
* add analytics snapshot compaction ([45f6609](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/45f6609ad1b20a086fb7f31498ff150ed4358638))
* add API support for revoking a specific device session ([#471](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/471)) ([c894ea8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c894ea84bafa68b27f3c43254d650f7f8c039915))
* Add asset catalog pagination, sorting, and issuer filters ([d9c50d1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d9c50d1c2a40f42a7413974f7f0cd5f0bd25eba7))
* Add asset catalog pagination, sorting, and issuer filters ([1fca7f0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1fca7f0237fca6ec6f82179b09de3df4497ce235))
* add auto-rebalance worker running every 15 minutes ([c059944](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c059944e32523dd427fc241def84adf2c95d0fd5))
* add auto-rebalance worker running every 15 minutes ([0847d61](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0847d61bf8837860a5d4c86affb6eb0562d19de7))
* add automated database backup/restore system with drills ([25a9c90](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/25a9c901eb30e98ceb883a4859e86089f91ef32a))
* add basis points allocations, rebalance validation, USD view, and integration tests ([5e930ad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5e930ad016f9c83847aef1238af37d0de020c5b8)), closes [#859](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/859) [#861](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/861) [#862](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/862) [#863](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/863)
* add benchmark comparison endpoint and chart ([2a3462b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/2a3462b20f77831907d04dd3db1a8cd0b9b14e71))
* add blackbox probes for frontend, API, websocket, and docs ([3a18ca2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3a18ca2de47c69544597c4c837ea4ef5eeca09e9))
* add boot diagnostics panel for wallet detection and API status reachability ([14883c6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/14883c6dc980394e9a477f89475193474d0ebcb7))
* add chaos test for backend kill during rebalance ([26e71d3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/26e71d30f6a877659a6cb0e7bc57216ca5f7b5c4)), closes [#1025](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1025)
* add chaos test for backend kill during rebalance ([#1025](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1025)) ([7922858](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7922858d96b4f85626013ec0c1c27c67b3c9de1f))
* add compare-two-assets mode to PriceTracker ([#528](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/528)) ([494c61b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/494c61bf6cb9b1321201e2c67b90d879abc17c1b))
* add dead-letter queue strategy for exhausted worker retries ([b327d3e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b327d3ea030091179a69d29a3630b844ae9c0dd0))
* add draft portfolio support, auth curl docs, rebalance snapshot… ([ad7552e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ad7552eb0c4105dadaffb12b61b9710405371e0e))
* add draft portfolio support, auth curl docs, rebalance snapshots, wallet network detection, event replay validation ([e04ac2f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e04ac2f4e786753f1d5cb7c92bd67f1427c80348))
* add dry-run endpoints for portfolio and auto-rebalancer rebalances ([7dd94ce](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7dd94ceb6be6214aaec027b57c71da94c50f85e6))
* add dry-run endpoints for portfolio and auto-rebalancer rebalances ([0a6839c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0a6839c9eacd46db5d83ea5b97958e72604366f3))
* add dry-run functionality for portfolio rebalancing ([b593574](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b59357405de3386299b8c7ff7d80e319ea72052e))
* Add email digest for weekly portfolio summary ([#985](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/985)) ([6ff0fc9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6ff0fc92e7bd4d5b3d0d47f65c9659c101b89453))
* add GET /prices/ohlcv endpoint with OHLCV candles from price sn… ([ad61b17](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ad61b17e921165bc0f426bc2c86e154ba642c8ea))
* add GET /prices/ohlcv endpoint with OHLCV candles from price snapshots ([960dbd2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/960dbd250b276a8fb994a1f45a57890764c4c7cf))
* add i18n docs, contract testing, a11y scan, and allocation hist… ([542e95f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/542e95fb275608aed16d1ae984c9e8663776871b))
* add i18n docs, contract testing, a11y scan, and allocation history chart ([11dc9c0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/11dc9c06370fdb587fb670a4e88234093305ee29))
* Add infrastructure as code (Terraform) for cloud deployment ([f06865c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f06865c3a80c0e69c099897a87c999535bbd388a))
* Add infrastructure as code (Terraform) for cloud deployment ([b231949](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b23194964592b3ee6c686b2fe36a5e0fd362f3de))
* add migration checksum validation ([451d097](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/451d097c1ec4f6db02a52a29bb2354398a4c7ce3))
* add migration checksum validation ([dce97d9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/dce97d952d6318ab50f4e9533fc9494166916d12))
* add migration for notification delivery metadata and refactor notification service to utilize backoff delivery strategy ([7887cfe](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7887cfe419dddd135a33b96c70d9df0a3e8f5b1e))
* add notification log migration and enhance notification logging with backoff and attempt tracking ([04ddb9c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/04ddb9c98250f6b5f082d73f6259452c254cd939))
* Add optimistic concurrency control for portfolio updates ([5595e8f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5595e8fd9f0b4df38d06a33ee4a635d93205ba3e))
* add paginated rebalance history endpoint (closes [#995](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/995)) ([6990960](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6990960eecda689f9ea478dd72417886acefaa42))
* add paginated rebalance history endpoint (closes [#995](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/995)) ([5628bde](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5628bde5e844178508a955415d879ac24ed04b28))
* add per-portfolio steward transfer, capability bitset, differen… ([e688286](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e6882860fd1c81b810acd5ac5948aa7fce378343))
* add per-portfolio steward transfer, capability bitset, differentiated pricing errors, and machine-readable benchmarks ([741e618](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/741e618d8645c00a34639e97564136104b5b2f7b))
* add portfolio comparison API endpoint and frontend table ([556b8fe](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/556b8fea2d7cf004cde3387d279a0dc3e5ec2745)), closes [#986](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/986)
* add portfolio comparison API endpoint and frontend table ([#986](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/986)) ([0c2fa7e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0c2fa7eb2a3cb2d5ba5ced3e173d0fa7e0afdfcd))
* add portfolio public embed widget (issue [#1010](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1010)) ([9ebc552](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9ebc552e904aaf3a36d8de72378abe25ef3d1773))
* add portfolio public embed widget (issue [#1010](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1010)) ([6fb3bee](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6fb3bee12b2d972736fcab9b2c5983689abf7740))
* add portfolio rebalance cost summary ([eab3257](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/eab325799cb8b7813fc7dc470e6bfd9de292815d))
* add portfolio risk heatmap diagnostics endpoint ([a7b2696](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a7b26965c462b1971fbf5a5f36a34a13798fe78b))
* add portfolio risk score API endpoint ([b0edf86](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b0edf86d13fd199f76c9b9d7d6879ad4af60cc91))
* add portfolio settings page with full configuration ([7724d99](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7724d9983200447e769dbbbb61f3a1d8a3350b5f))
* add portfolio settings page with full configuration ([8ecd09e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8ecd09eaf5600983a2804d584c989f272520481e))
* Add portfolio value WebSocket feed ([fc43c21](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fc43c21a15e75c4bf704e5ec06fbf0b97ac0a5a9))
* add PortfolioCard component with interactive performance sparkline and allocation breakdown ([729d7de](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/729d7de6060d1dc84212d5d3eda5e9f29ffff282))
* add public portfolio sharing, keyboard shortcuts, onboarding to… ([961f067](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/961f06771dc3af4fe5ec3877407892fd4c2cb801))
* add public portfolio sharing, keyboard shortcuts, onboarding tour, and lighthouse CI config ([e281c72](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e281c723adf05b2b80c4bb52e5c59a14bcc87178))
* add public roadmap with now/next/later buckets ([#573](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/573)) ([e3ab0f9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e3ab0f9993971df742b4712d41f0a778faafe6f0))
* add public roadmap with now/next/later buckets ([#573](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/573)) ([512bdbb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/512bdbbae856c8c347d8b468e74e3b8793e9f2ff))
* add query timing metrics around databaseService hot paths ([2568dc8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/2568dc87112a1b6f8bc09e653db9533cc9ed8f67))
* add queue drain operation ([053e01f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/053e01fa6f6ed6374977a6c064c8bbe820eae60d))
* add queue drain operation ([686df1e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/686df1eb519f34431191e10023fbc15368f993a9))
* add Queue Operations Workflow documentation and health check sc… ([30458d6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/30458d64eb8251475b892e5ec8612fe0e4dc1112))
* add queue pause and resume operations ([2f28ea2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/2f28ea296593c7e2c9a7d3cf26ec8f24330cdc4b))
* add queue pause and resume operations ([ee091f2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ee091f2ef50b256283602305dfbe3759ffb6c616))
* Add rebalance history timeline view (resolves [#1003](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1003)) ([fbd4736](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fbd4736300167f5011c4bd51b6223e60f9d59643))
* Add rebalance history timeline view (resolves [#1003](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1003)) ([f42ecc4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f42ecc4f99ed1182d807446d1f46983288590612))
* add session metadata, digest controls, PR issue-lint workflow, … ([0509807](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0509807ab0d52c3d2bd0d9b74c2c4aa9b569d9ab))
* add session metadata, digest controls, PR issue-lint workflow, and startup fingerprint ([7f2eca4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7f2eca4b11511b6ed183eaac88f871c3551d798d))
* add snapshot diff tooling for upgrade state comparison ([#419](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/419)) ([cf825ec](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/cf825ec65392153de1e7724f8683abbaf1cf060d))
* add snapshot diff tooling for upgrade state comparison ([#419](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/419)) ([19462e5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/19462e55bcf196d5e3996d2fe1e09f35f2a0e680))
* Add SQL query explain endpoint for performance debugging (admin only) ([60318d3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/60318d3ec9fe21ffea1c51fea86578464a40fabf)), closes [#988](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/988)
* Add SQL query explain endpoint for performance debugging (admin… ([a659bb2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a659bb21dac3faea74ebaadf2ecbc31d9c3d2421))
* add support for PostgreSQL full-text search on portfolio names ([b6d25d8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b6d25d8fae40598ede6e478e70a1db05512de814))
* Add support for PostgreSQL full-text search on portfolio names ([70aa87c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/70aa87cdac71ac9c30946a66f0766ffb852f6c8e))
* add suspicious login heuristics and security event logging ([041488b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/041488b5f4d82412e85693f292a2ae19dcfdcb66)), closes [#423](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/423)
* add suspicious login heuristics and security event logging ([#423](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/423)) ([e24d834](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e24d83401865802fe8da2472c7f7a270b51ce26a))
* add tax report endpoint with FIFO gain/loss computation ([173b868](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/173b868266875bce4aff3b7b1d1def786b8b0d06))
* add tax report endpoint with FIFO gain/loss computation ([1a6c089](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1a6c089e567e3547a64a79542291e8a6b2420719))
* add telegram bot notification channel ([#989](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/989)) ([9ad520d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9ad520d23833b00a6144981f60c92649aee31b3e))
* add telegram bot notification channel ([#989](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/989)) ([4523e64](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4523e64f38738cca4ddd27ef115a527e77b2fdf4))
* add weekly email digest for portfolio summary ([#985](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/985)) ([8ef28a1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8ef28a1ed385d1c466c47ea25cdbef75f04a128d))
* **analytics:** add correlation matrix endpoint with 1-hour cache ([2b0105e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/2b0105edf0c0ee00da58b4b32c2fcfee9580a6c7))
* **analytics:** add correlation matrix endpoint with 1-hour cache ([19392eb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/19392ebe0daf8a487e287be68e54c4281b3f21dc))
* automate staging seed and reset workflow ([b3c333a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b3c333a4154022e6a035306460a7b7fd33fe5951))
* **backend|docs:** issue summaries ([5e4e06d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5e4e06d4d41f1ab38bbd33eb89cf7aa2b734dabb))
* **backend|docs:** issue summaries ([117090e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/117090e90acf5a696fe5f6d86d94603c7b70517c))
* **backend:** add API key management for programmatic access ([3c41057](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3c410577f1d933b85ec3bce5c4f31bc6c1b33eec))
* **backend:** add API key management for programmatic access ([75fb3bf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/75fb3bf303b01ccc3f28085b8db9f4f0c5ede2b4))
* **backend:** add price history storage with 5-min snapshot and 90-day pruning ([7da872e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7da872e7fe0fd38fe938c22d49a9d7b0da80516b))
* **backend:** add Redis-based demo session store with 1-hour TTL ([0824e68](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0824e686c12916bcba17e98ab695a7342ac0fcce))
* **backend:** add Stellar address authentication via challenge-response ([51ea19a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/51ea19ad169f544447aeb0a33cd1fb98956f16d9))
* **backend:** add Swagger TypeScript SDK codegen via openapi-typescript ([c95ac0d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c95ac0d3ccf8fcfe42fcfbf321b93c796a03acc4))
* **backend:** migrate rebalance locks to pg advisory locks for singleton worker exclusivity ([b63e5c0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b63e5c0dfb2f2971dd02ed4c8c114bd535210e45))
* **backend:** migrate rebalance locks to pg advisory locks for singleton worker exclusivity ([dfef4f5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/dfef4f576923f0f0d993e0ff48bbb8469764c6b8))
* basis points allocations, rebalance validation, USD view & integration tests ([ee02772](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ee0277236d7f061086d15bdf416f692826d60641))
* bypass strict rate limits and CORS checks for trusted health probes ([#464](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/464)) ([0ad9f75](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0ad9f75b4689a944b4e0e2f105a8411f673c62dc))
* Bypass strict rate limits for internal health probes only ([fe99ab3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fe99ab3b23a42499032d42481731c1b66ba8f3d7))
* **ci:** WASM hash publication ([#550](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/550)) & API change enforcement ([#551](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/551)) ([cfe319b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/cfe319be1be380a5cbc19e6a0c5422825f89058d))
* compact old analytics snapshots to reduce storage costs ([d2fca7e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d2fca7e9abf00abb9a3c9ce2dd1039e321f2fb0f))
* **config:** centralize and validate rate limit settings on startup ([99de24b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/99de24b9d252756c984bced86a2f66135208f12f))
* **consent:** store and verify immutable consent text SHA-256 versio… ([db8bcce](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/db8bcce1e584147fec81e94c5c33a1dde553b31e))
* **consent:** store and verify immutable consent text SHA-256 version hashes ([91d1640](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/91d16401a1ca677f035561a132b2502d339b8e37))
* **contracts:** add cargo-fuzz targets for rebalance and allocation flows ([3fd848b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3fd848bab84e8493577fddf4fa3cea436f28379a))
* **contracts:** add consolidated config snapshot view ([7883b70](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7883b70f001b60436a84ade532742b07ee58c42a))
* **contracts:** add fuzzing for rebalance, oracle prices, and allocations ([e46e144](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e46e144b15fa3c19d3144025ba1a7eaec4456b3e))
* **contracts:** add memo support, fee config, upgrade workflow, and … ([2099048](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/209904803721578ec76e39b6f30b972063d6f63d))
* **contracts:** add memo support, fee config, upgrade workflow, and event fixtures ([294920f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/294920f342ea3fbb35271eff43da30e3fd3560b9))
* **contracts:** add portfolio storage footprint guardrail ([10d21ed](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/10d21ed7b696bc18978f480dcdf6d357c1d1ee7b))
* **deployment:** add contract promotion pipeline ([d0424d5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d0424d53cdc7e02926089add9b79e938ff57e15c))
* **deployment:** add contract promotion pipeline ([f099839](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f0998394561d473d3f18ed0a450a60b84d712a2a))
* **devops:** add one-command local observability bootstrap ([18a286b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/18a286bca507feb2ffdcc514a7cd7cf62bee34c4))
* enhance dry-run endpoints for portfolio and auto-rebalancer with detailed response schemas and improved descriptions ([a7d6f11](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a7d6f11b8d9281db6832f874277c862200888c66))
* enhance notification delivery configuration with backoff policies and add unit tests for delivery retries ([37b92fe](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/37b92fe0aac18799a783f1810742f6dcafc2b786))
* **frontend:** add candlestick chart for asset price history ([086c906](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/086c90638d6da6e95c7e8317f308953f79905528))
* **frontend:** add candlestick chart for asset price history ([385948d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/385948d211a6a0d6c99761f05050054029c277d5))
* **frontend:** add contract capability matrix and compatibility dete… ([ff350ad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ff350ad22a47548a7939bab05d0d9b2a105d8394))
* **frontend:** add contract capability matrix and compatibility detection ([6cd0670](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6cd0670e1cbab937e93275f9d1fdc2c838daaf0c)), closes [#834](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/834) [#845](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/845) [#846](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/846) [#848](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/848)
* **frontend:** add live allocation drift gauge on dashboard ([a3ea62e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a3ea62eeb46573143a7725907a8ef8d3fbf823af))
* **frontend:** add live allocation drift gauge on dashboard ([800c917](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/800c91771e757b71073c963e9cdb8e79ba6105d7))
* **frontend:** add notification mutation microstates ([552531f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/552531f0d4ef55d3b7a8076402615c0771188ac9))
* **frontend:** add reconnect CTA and diagnostics to realtime status banner ([526c345](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/526c34536998da84e7f6ad009adc7d72c2f2fee8))
* **frontend:** add rule-based portfolio suggestions ([907f827](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/907f827711632e7d4350fed78c478dc0f53f783c))
* **frontend:** add rule-based portfolio suggestions ([7195843](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7195843dfcb30f1202b793ec1936295ca254faed))
* **frontend:** improve offline refetch, legal versioning, theme sync, and landing trust ([c6ecf84](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c6ecf848954ed83750e483d436dd54e2496323bf))
* **frontend:** improve offline refetch, legal versioning, theme sync… ([90a4af5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/90a4af52451b66d88e179d8e96a9cfdd56ecbdae))
* **frontend:** portfolio clone, dev drawer, API probe, and price cac… ([e37e5c7](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e37e5c76885f34b9813809ca3ec8a654d39685de))
* **frontend:** portfolio clone, dev drawer, API probe, and price cache inspector ([48522b9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/48522b9f030a25b8c35b4f4b3a2f07ee5da19d22))
* **frontend:** rebalance confirm, boot splash, realtime status, expo… ([810439f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/810439f21768245d3a9bfe652830a05b38274ba0))
* **frontend:** rebalance confirm, boot splash, realtime status, export progress ([372576c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/372576c1ca6583da37c7b1ab3ac32bda0550fd81))
* **frontend:** rebalance preview, i18n copy, reduced motion, and das… ([be66a89](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/be66a89c87945d2129d23cbb48b35e8885b3ff56))
* **frontend:** rebalance preview, i18n copy, reduced motion, and dashboard a11y ([9b35965](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9b35965c13ce819e47052ddcc93b1c9a6055d3f0))
* hash request payloads in idempotency records to detect semantic mismatch ([ad7e795](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ad7e79510f74fa1d5e9ca834c7234c9a08952c91))
* health endpoint, Redis price cache, correlation-id logging, enh… ([b0a9ccb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b0a9ccb0f2bf9b268eb9072ab0dbd0076ab0ef95))
* health endpoint, Redis price cache, correlation-id logging, enhanced analytics ([9d3ca17](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9d3ca178eb8344540e1ac532546103fb108da6f8))
* **http:** mount dynamicRateLimiter centrally for all API routes ([a3b1fe9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a3b1fe92c683dde23e4635898ee82c90d8591cf0))
* implement auth token rotation, migration docs, contract error c… ([07601d5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/07601d5cd05a32463734dc334a9bfdb0c0c99055))
* implement auth token rotation, migration docs, contract error codes, and webhook dead-letter queue ([918f2a6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/918f2a66e410d2adf278907781b4a56be5214b6c))
* implement bounded retry for queue connection bootstrap ([d61bbd5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d61bbd599e321a344f6e0fbf4b5eb4c7378415b1))
* implement configurable cooldown, error path tests, supported asset list, benchmarks ([1f7fb4a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1f7fb4ac1edc5d1d5b3c42045c4f435d3380fd9c))
* implement configurable cooldown, error path tests, supported asset list, benchmarks ([1dcb880](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1dcb88001a56e098cf0b2ea8a19fdd04e20e21be))
* implement consent history, shadow mode, notification defaults, … ([9228e7f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9228e7fed4606d1030e5cf3744d30efa412938ef))
* implement consent history, shadow mode, notification defaults, idempotency logging, and fix pre-existing corruption ([14a6440](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/14a64404b318ed1b48935ad730e4e0ca872a3101))
* implement dry-run endpoint for portfolio rebalancing ([4f1324e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4f1324e7b4dcd56a42faeab8f85c91b50664a60b))
* implement error boundary, allocation form, WS price feed, and r… ([4254136](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4254136c3219a691a5de9409cfb60a955cd8a514))
* implement error boundary, allocation form, WS price feed, and real-time hook ([366802a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/366802a06e8d9167e1ec4f2af95de57c6c1fabae))
* implement features [#1021](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1021), [#1039](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1039), [#1035](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1035), [#1018](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1018) ([e09d2eb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e09d2ebb12ee101cb5fa35a788107a753eddfb74))
* implement features [#1021](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1021), [#1039](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1039), [#1035](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1035), [#1018](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1018) ([1fd4182](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1fd41826cda2b42c3ae583c7ed11136df20028ce))
* implement four open source contributions ([63e0180](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/63e01809104bf143e560ef91e1858e06ccc53193))
* implement four open source contributions ([8f30bb3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8f30bb3b11432b8a2cde2b655441675f000ebf07))
* implement get_config_view snapshot and update test snapshots ([5719d45](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5719d459226e2c9bef9d75012d54119a9585c13b))
* implement infrastructure monitoring and readiness diagnostics for backend services ([6d1b16c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6d1b16ce7a6e447865241d301b9c470de04d51a1))
* implement infrastructure monitoring and readiness diagnostics for backend services ([acd878f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/acd878ff77194ef70eeb95fec9a80b6d50ea35c9))
* implement notification delivery configuration and backoff policies for email and webhook notifications ([33b6add](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/33b6add14bf624f23c17896a7ce9bb28b0cb22d5))
* implement observability metrics and database service with query tracking ([d243d88](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d243d88118dfe06aaa040d780a38d2ee1d717d22))
* implement OpenTelemetry tracing, rate limiting, BullMQ jobs, an… ([b9b710e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b9b710ed79e9e470b91d904059820e240617cc61))
* implement OpenTelemetry tracing, rate limiting, BullMQ jobs, and OpenAPI docs ([28914c4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/28914c42d5a107295b4541880fe2fda8fe79f7a6))
* Implement portfolio import/export ([f22fd38](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f22fd3820af1f37d42b51cc45e29171cf503d10b))
* Implement portfolio import/export ([109b096](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/109b096c678ec107283eba0030e94b7f35cae920))
* implement three OSS contributions ([daa6408](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/daa6408ee3b5768d22a14f63d021ee23a4632931))
* implement three OSS contributions ([de30548](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/de3054871e09e16dd869fc21affe0f9e89bd331b))
* implement user preferences API (GET/PUT /api/v1/preferences) ([aac6efe](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/aac6efe69e48e71c61cbbc6c83cfbc26dca7722a)), closes [#981](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/981)
* implement user preferences API (GET/PUT /api/v1/preferences) ([d6231ea](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d6231eaf284d8431518c09b18ac25ba448ddcd96)), closes [#981](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/981)
* implement user preferences API (rebased) ([aea83fc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/aea83fc74bf375f29ee1a6bfdb0a8005dcb4a703))
* market movers endpoint. ([8846380](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8846380bd522c5759dbb06fe0aab38002201aef4))
* market movers endpoint. ([ecf7d36](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ecf7d36f8cbe36f3b8facd67fc61b29001c75039))
* **observability:** document and enforce Loki retention and compaction policy ([#535](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/535)) ([bb9d3b4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bb9d3b4a7f2b7acd10331579eabbcef0570f131b))
* Prepare contract admin flows for future multisig/governed deployment ([684ebcb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/684ebcb51432a3909148d259720e1330ba23b3a7))
* refac rate limit policy ([bc94c71](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bc94c71412bf2428daf1ed7cfd784030c27b957d))
* resolve multiple issues including structured events, upgrade path, pause mechanism, and frontend fix ([ba69458](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ba69458d3b19c4c78308ef82a8fd4bd4866663b3))
* resolve multiple issues including structured events, upgrade path, pause mechanism, and frontend fix ([5589f9e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5589f9e305a817830e3185a0b9ddc3b4de6ac77b))
* return best-execution explanation data from DEX service ([#460](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/460)) ([e5df1e5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e5df1e52bac5bdd9265c5286bcff4660dc480b23))
* **security:** add contract audit checklist and self-audit report ([990ffa0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/990ffa0ba33a279ab43b13452dcda3a3a387bbf0))
* **security:** add contract audit checklist and self-audit report ([d95963c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d95963cc65fedac443b184ac97b16396d86f3c7c)), closes [#1026](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1026)
* **security:** verify webhook notification signatures ([4101f49](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4101f4911933515f3e3c01ab68c3d0e50c5a6773))
* show consent version history before re-acceptance ([a578520](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a578520169137670c15247930a870d68d6b3f402))
* standardize rebalance reason codes and history taxonomy ([6346b5b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6346b5bbe22fd4102f42e331439ab54bcaf7ec0e))
* standardize rebalance reason codes and history taxonomy ([7add927](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7add92700addcd48cfcbbad63cc9bebab0f7ef5f))
* support clone-portfolio endpoint for quick strategy duplication ([1df79c4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1df79c44667a1f5262054ae921d945851772c162))
* **testing:** add backend integration tests for rebalance job queue ([6ec17f2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6ec17f2194082f545b4b5f234745c28e9e67fd4f))
* **testing:** add backend integration tests for rebalance job queue ([4dcd9f8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4dcd9f85bf2083f48183f9c8fa669e82f8b73284)), closes [#1048](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1048)
* track freshness of asset registry sources and quarantine stale … ([fbd09eb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fbd09ebe4a4749be6961ecd98745805026d2a6fb))
* **ui:** add actionable empty states to dashboard and portfolio setup ([eab2538](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/eab25381f48dfa36068ca3f508843706b9b34d0c))
* **ui:** add dashboard/card/history skeleton loaders and fix dashboa… ([af49ae1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/af49ae1779daf000bfbf3ad160c1a156890a66dc))


### Bug Fixes

* **#466:** unify shared API validation error examples across route mo… ([16fd180](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/16fd18073800d9aef6913736c6a80241d8bc3046))
* **#466:** unify shared API validation error examples across route modules ([d686e46](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d686e46df8e583b9c5db35a68347330e4cb8df67))
* add CORS policy, API deprecation, DB pool config, and Zod validation ([e7c41fc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e7c41fc7c844786d84f9ce471606f2ee53c5e6ab)), closes [#883](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/883) [#882](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/882) [#881](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/881) [#879](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/879)
* add missing rebalance-status endpoint with correct timestamp ([02201ad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/02201adec2f9377fabd4ead973a7989654313ddf))
* add missing rebalance-status endpoint with correct timestamp ([5c0e2bf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5c0e2bfe93c5edb74a16422250bc8844f214841e))
* address CodeRabbit review comments and resolve contract build/frontend test failures ([0fc063b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0fc063bcca7888547218377765eed711252ca92d))
* address CodeRabbit review findings ([9bee660](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9bee660164f96bc838c19b5a10854d43c8f768a6))
* **chaos:** address code review issues in kill-backend-mid-rebalance script ([9bda9b6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9bda9b6e214396cdf7fc09ad3123cf718c50a25f))
* **ci:** fix three broken workflow scripts ([a07e029](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a07e029cec13dcd8e387e2733efa802b743dae6d))
* clarify optimistic portfolio rollback messaging ([3f77aba](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3f77abaf9405e2d1bbf35027141a49c24ba459e7))
* configurable CORS, API deprecation, DB pool exhaustion, Zod validation ([195243a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/195243aafe57b3b2f9ca4a9b8b7366f258c23d46))
* **contracts:** reject duplicate asset maps in portfolio creation ([#411](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/411)) ([96c5674](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/96c56740118fe92c8c0464694c40298f6ec953cb))
* **contracts:** reject duplicate asset maps in portfolio creation ([#411](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/411)) ([ddd04ac](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ddd04acae78c4c1b2f09bc41f8cbdd27b810f318))
* **deployment:** harden contract promotion ([9364e3d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9364e3dfd23c84e6d7b3f42568ca5049f3f456c8))
* enforce two-decimal precision on percentage inputs before bps conversion ([89b7041](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/89b7041f4bc7a4e3d290fb2bf788f3c5b5dc0cc9))
* **frontend:** address notification microstate review ([d252059](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d2520592e562e9bffe79cbc3c99282bf7ff2de6c))
* **frontend:** harden portfolio suggestions ([c326c88](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c326c88113b70a1a32f94d8b210a34aac1bfe89b))
* **frontend:** scope portfolio suggestion test ([9a1e49b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9a1e49bb9ef9deb9d1efe20668a950eafcd9b0ca))
* resolve all blockers for portfolio import/export feature ([#893](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/893)) ([19ab8c1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/19ab8c1e48cd0916d5213eef22e0bd04befb7ada))
* resolve merge conflicts and fix CI failures ([e09858d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e09858d053823e09178ef1e58d59ba57c5599381))
* resolve multiple portfolio rebalancer issues ([bbe6ef3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bbe6ef3d97301efeb3db43c94cd27ec17a4cda4b))
* resolve multiple portfolio rebalancer issues ([fd1991a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fd1991a8fef86d9782f1c97cbafbff5f32b96d60))
* resolve pre-existing source/test syntax errors and test mock issues ([fdeecb0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fdeecb0c9230b82dcad5ecfbbd51c03748535ec8))
* resolve pre-existing source/test syntax errors and test mock issues ([55e5479](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/55e547952aa76642c9d9e94454f04760e2f95d22))
* restore missing contract methods and event serialization from previous revert ([7a38c7d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7a38c7d41f709518c6fc72e4f53055df645d24e5))
* standardize error handler responses ([e3cf973](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e3cf9735e5bffedb0dba3073037e4b5a92adee29))
* validate ledger timestamp drift in time-sensitive operations ([0b93fae](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0b93fae4b1d65fd917d209ecc8dd25646bde018b))
* validate ledger timestamp drift in time-sensitive operations ([9f4a25f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9f4a25f9439e27f169e6a5ed9f2e9c2e2e7e59f9))

## [Unreleased]

### Added

- Public roadmap with Now, Next, Later buckets ([#573](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/573))
  - Created `docs/ROADMAP.md` with detailed project roadmap
  - Added roadmap summary table to `README.md` for quick reference

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
