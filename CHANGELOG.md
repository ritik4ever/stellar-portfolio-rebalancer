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

## [1.4.0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/compare/stellar-portfolio-rebalancer-v1.3.0...stellar-portfolio-rebalancer-v1.4.0) (2026-08-06)


### Features

* add 4 components for open source contributions ([609cb46](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/609cb4609f341f0b2b1db7111daaf29670ad0e90))
* add 4 components for open source contributions ([a83a3bb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a83a3bb5d3b260ab71081322a5ae5daafe39121d))
* add 5-step PortfolioWizard page ([#998](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/998)) ([e1bb078](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e1bb0784ca9947a4e0117af27caf76317f641969))
* add 5-step PortfolioWizard page (closes [#998](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/998)) ([142e292](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/142e2926ad7a63eaf57bc3653f242a807403868e))
* add asset search by domain, wizard draft persistence, settings … ([310e8df](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/310e8dff7f0819e6321a9a3f076e911cc31e23c3))
* add asset search by domain, wizard draft persistence, settings import/export, and asset freeze toggle ([5fb2e6c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5fb2e6c2bd7365db2c0e69dc7f8b3f32e4d7feeb))
* add auto-rebalance worker running every 15 minutes ([c059944](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c059944e32523dd427fc241def84adf2c95d0fd5))
* add auto-rebalance worker running every 15 minutes ([0847d61](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0847d61bf8837860a5d4c86affb6eb0562d19de7))
* add automated rollback on failed health check ([0966863](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0966863209107eb3e4db789aca2daba4e02b3eb3))
* add automated rollback on failed health check ([a9f50dc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a9f50dc1e6c961f1d1b80d167a0d4c0412c3e5e4)), closes [#1491](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1491)
* add basis points allocations, rebalance validation, USD view, and integration tests ([5e930ad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5e930ad016f9c83847aef1238af37d0de020c5b8)), closes [#859](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/859) [#861](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/861) [#862](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/862) [#863](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/863)
* add batch rebalance and frontend perf budget ([ef0e7ed](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ef0e7edb2edbf07c8ff023761deff14d0cbe368b))
* add batch_rebalance for multi-portfolio rebalances and enforce frontend Lighthouse budget ([a765ff5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a765ff539caa09e3782497490c6f1d04c4f443b1))
* add benchmark comparison endpoint and chart ([2a3462b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/2a3462b20f77831907d04dd3db1a8cd0b9b14e71))
* add benchmark regression summary script (Closes [#563](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/563)) ([a4e2bcf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a4e2bcf0582004807d1bcdd541530bc76feabaa9))
* Add capability-aware disabled-state indicator for update_alloca… ([1f32748](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1f32748800a13beb7fb4046694a3fdf57291e82d))
* Add capability-aware disabled-state indicator for update_allocations ([d520c3b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d520c3b222e24e073b966452b472f9fbd186615b))
* add chaos test for backend kill during rebalance ([26e71d3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/26e71d30f6a877659a6cb0e7bc57216ca5f7b5c4)), closes [#1025](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1025)
* add chaos test for backend kill during rebalance ([#1025](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1025)) ([7922858](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7922858d96b4f85626013ec0c1c27c67b3c9de1f))
* add connection-quality indicator and tracking ([472a724](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/472a724f7cf30408a8424b8e2e0be25c8294b1b6))
* add connection-quality indicator and tracking ([d86b549](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d86b549afbc4f029d58edf8f00321eccc9557a26))
* add contract WASM size regression check to CI ([5264502](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/52645027f87122c7dd087c6a6cc6a7112fd1044f))
* add contract WASM size regression check to CI ([baf670b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/baf670ba19e0593092a7bbad11f55bdea96ad678)), closes [#1495](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1495)
* add contract-capability diff viewer in DeveloperDrawer ([10add06](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/10add064c7a85ea391815c771f4603f8771eccbd))
* add contract-capability diff viewer in DeveloperDrawer ([dc78623](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/dc78623eaf973e62eba1b71a5d7dd36064349a28)), closes [#1463](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1463)
* add diff view between two allocation-history points ([77096d6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/77096d62cbe1a4c1c41365c9ed648fe77efec9ae))
* add diff view between two allocation-history points ([8f56a11](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8f56a1159ceda8ee12c56d8026799c4aab575df2)), closes [#1467](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1467)
* add Docker Compose resource limits (Closes [#560](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/560)) ([0f612c6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0f612c6b26211ba4e5b2eed8b2f4e6cc718ccbbb))
* add document bulk import endpoint ([e0ed4a2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e0ed4a2ffdfc6a8c59180f7b4f493005f2494629))
* add document bulk import endpoint ([474c99f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/474c99f8cca6fb1b0990accab46151349c982c0d))
* add drag-to-rebalance interactive mode for AllocationPieChart ([#1466](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1466)) ([c6553f6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c6553f669001e8cb37a46fe968a95a193a9f2eed))
* add drag-to-rebalance interactive mode for AllocationPieChart ([#1466](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1466)) ([9f7cd61](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9f7cd614ae17dcc336332dfa52bc71a9a9abbfbb))
* Add email digest for weekly portfolio summary ([#985](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/985)) ([6ff0fc9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6ff0fc92e7bd4d5b3d0d47f65c9659c101b89453))
* add env example sync verification (Closes [#552](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/552)) ([f3a3ea7](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f3a3ea75adf3eacbdcd48b1ffc0710b3d91094c1))
* add ErrorFallback component ([d4de6d3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d4de6d39260afacb90d3d8b15847c8f9c80aba61))
* Add exponential backoff reconnect to live feed hook ([6019710](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/60197109fd3b05cb9d2c07159c20ef868745be74))
* add GET /prices/ohlcv endpoint with OHLCV candles from price sn… ([ad61b17](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ad61b17e921165bc0f426bc2c86e154ba642c8ea))
* add GET /prices/ohlcv endpoint with OHLCV candles from price snapshots ([960dbd2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/960dbd250b276a8fb994a1f45a57890764c4c7cf))
* add granular consent categories for analytics and marketing ([a7ba5cb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a7ba5cbdf952a92f8d0e00a61a7bcabc6a8d26f1))
* add granular consent categories for analytics and marketing ([482bc3b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/482bc3b9a5d8a256563622949a495ea0fde5d6f7)), closes [#1468](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1468)
* add health smoke check script (Closes [#559](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/559)) ([d4011d2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d4011d22b7468f65f8c0187fdce35b073a6ab575))
* add i18n docs, contract testing, a11y scan, and allocation hist… ([542e95f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/542e95fb275608aed16d1ae984c9e8663776871b))
* add i18n docs, contract testing, a11y scan, and allocation history chart ([11dc9c0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/11dc9c06370fdb587fb670a4e88234093305ee29))
* Add infrastructure as code (Terraform) for cloud deployment ([f06865c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f06865c3a80c0e69c099897a87c999535bbd388a))
* Add infrastructure as code (Terraform) for cloud deployment ([b231949](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b23194964592b3ee6c686b2fe36a5e0fd362f3de))
* add keyboard accessibility to allocation slider ([66f5591](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/66f559165d8d9d1a93369a6b72251ced640644ca))
* add Lobstr wallet, dynamic portfolio comparison, OG meta tags, … ([bd8d6c8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bd8d6c8de7033ec4014ac4e36a74669af973bc3f))
* add Lobstr wallet, dynamic portfolio comparison, OG meta tags, and embed widget params ([cbe3cd2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/cbe3cd29b368dc4d152dfdf365d33c27e70b0533))
* add local observability bootstrap (Closes [#558](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/558)) ([d723cad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d723cad4637b5e13d4a59fcfd8e0d13d671dbf29))
* add local Reflector oracle mock service for offline dev ([f652285](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f652285093c075085da6475f23f4a0adbecd7526))
* add local Reflector oracle mock service for offline dev ([9a73f72](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9a73f723f7d8f1edd1614efe7cbd636423d730ca))
* add missing translation keys audit ([5d90f09](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5d90f09e1165324ec220ffed100bdc5ee0a9d334))
* add missing translation keys audit ([6922aaa](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6922aaa4985afb179b34ce93f4e1d804fff1d705))
* add npm-audit/cargo-audit dependency scan CI gate ([a73b456](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a73b4565baace9df3f796e274efebae542300080))
* add npm-audit/cargo-audit dependency scan CI gate ([624e482](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/624e482985f1cc15ff87a2b2ca3b6df0b58ff6aa)), closes [#1498](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1498)
* add npm-audit/cargo-audit dependency scan CI gate ([3f3d791](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3f3d791002eed9377b282b09b171fe22abd66053)), closes [#1498](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1498)
* add on-chain portfolio allocation templates ([a69b0f5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a69b0f58e3923463970b7ba32a66b843c6e3e781))
* add on-chain portfolio allocation templates ([975c768](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/975c768c2695f35ad3aaf4c2d2ba2f65d49bf983))
* add oracle price sanity check with cross-oracle validation ([f00f755](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f00f7550ac16dcf43873db98d98bb0b363b5c38d))
* add paginated rebalance history endpoint (closes [#995](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/995)) ([6990960](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6990960eecda689f9ea478dd72417886acefaa42))
* add paginated rebalance history endpoint (closes [#995](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/995)) ([5628bde](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5628bde5e844178508a955415d879ac24ed04b28))
* add polling to BackendCapabilitiesBanner, persist OnboardingChe… ([478e822](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/478e822d758de2ed3f2c05267300b2cf121370cf))
* add polling to BackendCapabilitiesBanner, persist OnboardingChecklist, add modal to CorrelationHeatmap, add breakdown tooltip to DriftGaugeGrid ([d0ce70b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d0ce70b10b520d49b1ebde64accab80ba31be06d))
* add portfolio archiving (soft delete) ([5c1a7e1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5c1a7e16afe66160f346fc11b19c1b4ecb5738af))
* add portfolio comparison API endpoint and frontend table ([556b8fe](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/556b8fea2d7cf004cde3387d279a0dc3e5ec2745)), closes [#986](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/986)
* add portfolio comparison API endpoint and frontend table ([#986](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/986)) ([0c2fa7e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0c2fa7eb2a3cb2d5ba5ced3e173d0fa7e0afdfcd))
* add portfolio public embed widget (issue [#1010](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1010)) ([9ebc552](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9ebc552e904aaf3a36d8de72378abe25ef3d1773))
* add portfolio public embed widget (issue [#1010](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1010)) ([6fb3bee](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6fb3bee12b2d972736fcab9b2c5983689abf7740))
* add portfolio rebalance cost summary ([eab3257](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/eab325799cb8b7813fc7dc470e6bfd9de292815d))
* add portfolio risk score API endpoint ([b0edf86](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b0edf86d13fd199f76c9b9d7d6879ad4af60cc91))
* add portfolio settings page with full configuration ([7724d99](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7724d9983200447e769dbbbb61f3a1d8a3350b5f))
* add portfolio settings page with full configuration ([8ecd09e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8ecd09eaf5600983a2804d584c989f272520481e))
* Add portfolio value WebSocket feed ([fc43c21](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fc43c21a15e75c4bf704e5ec06fbf0b97ac0a5a9))
* add PortfolioCard component with interactive performance sparkline and allocation breakdown ([729d7de](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/729d7de6060d1dc84212d5d3eda5e9f29ffff282))
* add pre-commit hooks config (Closes [#553](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/553)) ([9635c13](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9635c13044668f0d62f831c19d371d37a867aac9))
* add public portfolio sharing, keyboard shortcuts, onboarding to… ([961f067](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/961f06771dc3af4fe5ec3877407892fd4c2cb801))
* add public portfolio sharing, keyboard shortcuts, onboarding tour, and lighthouse CI config ([e281c72](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e281c723adf05b2b80c4bb52e5c59a14bcc87178))
* add rate-limiting rules at nginx layer ([0bbbef4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0bbbef404c02209760643e4d4fd987c23be4371d))
* add rate-limiting rules at nginx layer ([6638972](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6638972fa2a1551f9fea0cc08f7b35cbd663c35b))
* Add rebalance history timeline view (resolves [#1003](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1003)) ([fbd4736](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fbd4736300167f5011c4bd51b6223e60f9d59643))
* Add rebalance history timeline view (resolves [#1003](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1003)) ([f42ecc4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f42ecc4f99ed1182d807446d1f46983288590612))
* Add SQL query explain endpoint for performance debugging (admin only) ([60318d3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/60318d3ec9fe21ffea1c51fea86578464a40fabf)), closes [#988](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/988)
* Add SQL query explain endpoint for performance debugging (admin… ([a659bb2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a659bb21dac3faea74ebaadf2ecbc31d9c3d2421))
* add staging seed and reset script (Closes [#561](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/561)) ([3788263](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3788263699960f7b33bd8f9ca1be1996524016de))
* add strategy and strategy_config fields to Portfolio struct ([ef4639b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ef4639bc01d51b4111c8874ea287e07d5e4be7ba))
* add strategy and strategy_config fields to Portfolio struct ([#1143](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1143)) ([42e89dd](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/42e89ddd9457b6bf8bb3fe73fec734383b8d7e6e))
* add support for PostgreSQL full-text search on portfolio names ([b6d25d8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b6d25d8fae40598ede6e478e70a1db05512de814))
* Add support for PostgreSQL full-text search on portfolio names ([70aa87c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/70aa87cdac71ac9c30946a66f0766ffb852f6c8e))
* add tax report endpoint with FIFO gain/loss computation ([173b868](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/173b868266875bce4aff3b7b1d1def786b8b0d06))
* add tax report endpoint with FIFO gain/loss computation ([1a6c089](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1a6c089e567e3547a64a79542291e8a6b2420719))
* add telegram bot notification channel ([#989](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/989)) ([9ad520d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9ad520d23833b00a6144981f60c92649aee31b3e))
* add telegram bot notification channel ([#989](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/989)) ([4523e64](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4523e64f38738cca4ddd27ef115a527e77b2fdf4))
* add testnet/mainnet switch confirmation modal ([33c45bc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/33c45bc5d5d2f07655a6ba93327efad9fd42937f))
* add toast stacking and queueing system ([#1480](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1480)) ([bdee3b2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bdee3b2b7b31fbe9b906e0ae8974b0e92b11ebd7))
* add useBulkImport mutation hook with per-row validation error handling ([#1476](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1476)) ([96f3faf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/96f3faf9c9605f0371c4fb18997bc4c06de40220))
* add useBulkImport mutation hook with per-row validation error handling ([#1476](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1476)) ([c2bcc64](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c2bcc64fa9ba67bdfa6469c55d23385f13059352))
* add wallet-specific bug report template (Closes [#569](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/569)) ([99c5151](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/99c51517f03d0bcf04d6a91945ac804e66a534c2))
* add weekly email digest for portfolio summary ([#985](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/985)) ([8ef28a1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8ef28a1ed385d1c466c47ea25cdbef75f04a128d))
* **analytics:** add correlation matrix endpoint with 1-hour cache ([2b0105e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/2b0105edf0c0ee00da58b4b32c2fcfee9580a6c7))
* **analytics:** add correlation matrix endpoint with 1-hour cache ([19392eb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/19392ebe0daf8a487e287be68e54c4281b3f21dc))
* **api:** add multi-portfolio dashboard summary endpoint ([6b0166f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6b0166fabb47280c7f9f269eb693e0c51c103e2e))
* **api:** add multi-portfolio dashboard summary endpoint ([80219bc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/80219bca8717523d5e19da6e5d9cff8764883e5b))
* **backend|docs:** issue summaries ([5e4e06d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5e4e06d4d41f1ab38bbd33eb89cf7aa2b734dabb))
* **backend|docs:** issue summaries ([117090e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/117090e90acf5a696fe5f6d86d94603c7b70517c))
* **backend:** add API key management for programmatic access ([3c41057](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3c410577f1d933b85ec3bce5c4f31bc6c1b33eec))
* **backend:** add API key management for programmatic access ([75fb3bf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/75fb3bf303b01ccc3f28085b8db9f4f0c5ede2b4))
* **backend:** add per-asset price alert threshold overrides ([3ec7da1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3ec7da120c3aab93cfc2f7178c2a81261ab66518))
* **backend:** add price history storage with 5-min snapshot and 90-day pruning ([7da872e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7da872e7fe0fd38fe938c22d49a9d7b0da80516b))
* **backend:** add Redis-based demo session store with 1-hour TTL ([0824e68](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0824e686c12916bcba17e98ab695a7342ac0fcce))
* **backend:** add Stellar address authentication via challenge-response ([51ea19a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/51ea19ad169f544447aeb0a33cd1fb98956f16d9))
* **backend:** add Swagger TypeScript SDK codegen via openapi-typescript ([c95ac0d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c95ac0d3ccf8fcfe42fcfbf321b93c796a03acc4))
* **backend:** implement portfolio clone endpoint POST /api/v1/portfolio/:id/clone and GET /api/v1/portfolios ([71ff4cb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/71ff4cb4804c4a9c4a2c96d3ee1c1fdc13c7fef1))
* **backend:** mount tax-report endpoint for FIFO tax reports ([a00cef2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a00cef20760c201dd93f8097156a68fcaf7c3aed))
* basis points allocations, rebalance validation, USD view & integration tests ([ee02772](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ee0277236d7f061086d15bdf416f692826d60641))
* **contracts:** add cargo-fuzz targets for rebalance and allocation flows ([3fd848b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/3fd848bab84e8493577fddf4fa3cea436f28379a))
* **contracts:** add dollar-cost averaging investment strategy ([811e6b4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/811e6b4c34157c68990e6ce4436c56194dbe7c11))
* **contracts:** add dollar-cost averaging investment strategy ([b95abf5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b95abf57937ef01ace36939b0bc5b574a30e1ab2))
* **contracts:** add fuzzing for rebalance, oracle prices, and allocations ([e46e144](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e46e144b15fa3c19d3144025ba1a7eaec4456b3e))
* **contracts:** add get_drift_preview for target allocation drift ([1857c85](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1857c855cc4c98bd028b069a82156674fc155925))
* **contracts:** add get_drift_preview for target allocation drift ([e81d6d4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e81d6d4602a2278e2b94dd1063243349711c9ec4))
* **contracts:** add per-asset slippage protection ([#962](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/962)) ([d9b6688](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d9b668858440579fba014517be4bcc3c6727d55e))
* **contracts:** add property-based tests with proptest (50k cases) ([1642eda](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1642edada5613fcbf794f37c47a0904a91f43f0d)), closes [#963](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/963)
* **contracts:** add property-based tests with proptest (50k cases) ([c440084](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c440084c226271b33ab0e309a1faa337ca78d9c9)), closes [#963](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/963)
* **contracts:** add property-based tests with proptest (50k cases) ([fb5d659](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fb5d659054156e6652de61751782e5505baff81b)), closes [#963](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/963)
* **contracts:** add testnet integration test suite and fix compilati… ([5dc957b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5dc957ba5979d9eab5b4ec297e5b72f666d593ad))
* **contracts:** execute portfolio rebalances with on-chain token transfers ([0f37ab5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0f37ab5728721fc70d9fdc95e337c39bf2dbb591))
* **contracts:** replace internal rebalance bookkeeping with on-chain asset transfers ([626ae37](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/626ae37149deb59ea4d82a29e45b0bf15dc356ad))
* **deployment:** add contract promotion pipeline ([d0424d5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d0424d53cdc7e02926089add9b79e938ff57e15c))
* **deployment:** add contract promotion pipeline ([f099839](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f0998394561d473d3f18ed0a450a60b84d712a2a))
* **devops:** enable automated RDS and Redis secret rotation with dyn… ([715b862](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/715b86248b5788b2638ae2c05c3513c5741a5aa5))
* **devops:** enable automated RDS and Redis secret rotation with dynamic credential manager ([47ec03a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/47ec03a38111233fc1f9be17d65088a80b4e260e))
* **ecs:** add autoscaling based on queue backlog depth ([fc3cccf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fc3cccfbf29067cf5f4847e466cf55c59be04694))
* **frontend:** add candlestick chart for asset price history ([086c906](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/086c90638d6da6e95c7e8317f308953f79905528))
* **frontend:** add candlestick chart for asset price history ([385948d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/385948d211a6a0d6c99761f05050054029c277d5))
* **frontend:** add contract capability matrix and compatibility dete… ([ff350ad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ff350ad22a47548a7939bab05d0d9b2a105d8394))
* **frontend:** add contract capability matrix and compatibility detection ([6cd0670](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6cd0670e1cbab937e93275f9d1fdc2c838daaf0c)), closes [#834](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/834) [#845](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/845) [#846](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/846) [#848](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/848)
* **frontend:** add customizable keybindings ([f0c680d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f0c680d815c1184904ada6b795ea4ae8675fdca9))
* **frontend:** add drag-and-drop bulk portfolio import ([b4d4acf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b4d4acfb3a757bbb04085656402aec01535861f8))
* **frontend:** add live allocation drift gauge on dashboard ([a3ea62e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a3ea62eeb46573143a7725907a8ef8d3fbf823af))
* **frontend:** add live allocation drift gauge on dashboard ([800c917](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/800c91771e757b71073c963e9cdb8e79ba6105d7))
* **frontend:** add portfolio analytics page ([cd42403](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/cd4240347e3d34077df38f62c86c36f8c43b18db))
* **frontend:** add rule-based portfolio suggestions ([907f827](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/907f827711632e7d4350fed78c478dc0f53f783c))
* **frontend:** add rule-based portfolio suggestions ([7195843](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7195843dfcb30f1202b793ec1936295ca254faed))
* **frontend:** add tax report page ([08d94ac](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/08d94ac124bc96d14bf6a10fbeb25831a0318358))
* hash request payloads in idempotency records to detect semantic… ([e0d9936](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e0d99364eca2fff2ae9d60c9f42311c4bcbae179))
* health endpoint, Redis price cache, correlation-id logging, enh… ([b0a9ccb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b0a9ccb0f2bf9b268eb9072ab0dbd0076ab0ef95))
* health endpoint, Redis price cache, correlation-id logging, enhanced analytics ([9d3ca17](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9d3ca178eb8344540e1ac532546103fb108da6f8))
* implement 4 open source contributions ([e8037f1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e8037f1f10cfc8ec5232dce71e205d17c222bbe5))
* implement 4 open source contributions ([860a2ce](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/860a2ce0cbfa1f048cd21ba474fbb2ae8160f17d))
* implement 4 open source contributions ([4e37749](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4e37749d73d6102b61b26e6f93c826bea402d9e3))
* implement 4 open source contributions ([0fed438](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0fed438704cbb165dbcb1e47ac165053eacac49b))
* implement 4 open source contributions ([04d0e33](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/04d0e33b8b687432ab207d48ce8ab2f91c0cf892))
* implement 4 open source contributions ([c7b0f6b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c7b0f6b31b410ed2af1c92195c552c99e0e69d02))
* implement auth token rotation, migration docs, contract error c… ([07601d5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/07601d5cd05a32463734dc334a9bfdb0c0c99055))
* implement auth token rotation, migration docs, contract error codes, and webhook dead-letter queue ([918f2a6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/918f2a66e410d2adf278907781b4a56be5214b6c))
* implement configurable cooldown, error path tests, supported asset list, benchmarks ([1f7fb4a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1f7fb4ac1edc5d1d5b3c42045c4f435d3380fd9c))
* implement configurable cooldown, error path tests, supported asset list, benchmarks ([1dcb880](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1dcb88001a56e098cf0b2ea8a19fdd04e20e21be))
* implement consent history, shadow mode, notification defaults, … ([9228e7f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9228e7fed4606d1030e5cf3744d30efa412938ef))
* implement consent history, shadow mode, notification defaults, idempotency logging, and fix pre-existing corruption ([14a6440](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/14a64404b318ed1b48935ad730e4e0ca872a3101))
* implement contract-level stop-loss per asset ([#960](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/960)) ([4cfcae5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4cfcae57c46352fc9f017ff2d7dfb48f388c7c52))
* Implement DevOps infrastructure improvements ([156697b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/156697bd4950e0d7ad84869d26fe4d7fa7f5d200))
* implement error boundary, allocation form, WS price feed, and r… ([4254136](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4254136c3219a691a5de9409cfb60a955cd8a514))
* implement error boundary, allocation form, WS price feed, and real-time hook ([366802a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/366802a06e8d9167e1ec4f2af95de57c6c1fabae))
* implement features [#1021](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1021), [#1039](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1039), [#1035](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1035), [#1018](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1018) ([e09d2eb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e09d2ebb12ee101cb5fa35a788107a753eddfb74))
* implement features [#1021](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1021), [#1039](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1039), [#1035](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1035), [#1018](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1018) ([1fd4182](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1fd41826cda2b42c3ae583c7ed11136df20028ce))
* implement fee transfer, circuit breaker persistence, queue back… ([11ca2c0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/11ca2c0be1ece37d98b99e9669a31ddb4d662efa))
* implement fee transfer, circuit breaker persistence, queue backlog alert, and strategy selector tests ([d587c17](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d587c178bb61bdb80ac80510f07f2eaac3eb82af))
* implement four open source contributions ([63e0180](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/63e01809104bf143e560ef91e1858e06ccc53193))
* implement four open source contributions ([8f30bb3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8f30bb3b11432b8a2cde2b655441675f000ebf07))
* implement four OSS issues - idempotency failover, health summar… ([b8ee99c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b8ee99ce8fabfa054bb0be18567871531e070b6a))
* implement four OSS issues - idempotency failover, health summary, admin audit log, bulk import UX ([f67341e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f67341e4beccc0ad93c217fbb2bab1f947dd4bd2))
* implement infrastructure monitoring and readiness diagnostics for backend services ([6d1b16c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6d1b16ce7a6e447865241d301b9c470de04d51a1))
* implement infrastructure monitoring and readiness diagnostics for backend services ([acd878f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/acd878ff77194ef70eeb95fec9a80b6d50ea35c9))
* implement OpenTelemetry tracing, rate limiting, BullMQ jobs, an… ([b9b710e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b9b710ed79e9e470b91d904059820e240617cc61))
* implement OpenTelemetry tracing, rate limiting, BullMQ jobs, and OpenAPI docs ([28914c4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/28914c42d5a107295b4541880fe2fda8fe79f7a6))
* Implement portfolio import/export ([f22fd38](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f22fd3820af1f37d42b51cc45e29171cf503d10b))
* Implement portfolio import/export ([109b096](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/109b096c678ec107283eba0030e94b7f35cae920))
* implement portfolio NAV snapshotting with historical tracking a… ([00510b3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/00510b38212da6c6558c48f4905b72256f97e009))
* implement portfolio NAV snapshotting with historical tracking and automatic recording on rebalance ([50e89b9](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/50e89b985f6511c81b8e3e300c2f66c6e61973c3))
* implement portfolio resume, batch replay, DCA strategy, and cro… ([f2d1fa7](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f2d1fa736c22582e405ff82cca8611dc07abe7de))
* implement portfolio resume, batch replay, DCA strategy, and cross-check rebalance ([c0d2423](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c0d2423fafcd58e07f3b9b8c9c6b6597087cc79a))
* implement three OSS contributions ([daa6408](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/daa6408ee3b5768d22a14f63d021ee23a4632931))
* implement three OSS contributions ([de30548](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/de3054871e09e16dd869fc21affe0f9e89bd331b))
* implement user preferences API (GET/PUT /api/v1/preferences) ([aac6efe](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/aac6efe69e48e71c61cbbc6c83cfbc26dca7722a)), closes [#981](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/981)
* implement user preferences API (GET/PUT /api/v1/preferences) ([d6231ea](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d6231eaf284d8431518c09b18ac25ba448ddcd96)), closes [#981](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/981)
* implement user preferences API (rebased) ([aea83fc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/aea83fc74bf375f29ee1a6bfdb0a8005dcb4a703))
* implement volatility circuit breaker, update_allocations, struc… ([799543a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/799543a6e575ef0478978880737cddd255d11370))
* implement volatility circuit breaker, update_allocations, structured import errors, and import route fix ([5ed1777](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5ed17773b5b69dedb64bac247117d17f00042137))
* market movers endpoint. ([8846380](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/8846380bd522c5759dbb06fe0aab38002201aef4))
* market movers endpoint. ([ecf7d36](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ecf7d36f8cbe36f3b8facd67fc61b29001c75039))
* **observability:** add on-call paging receivers and synthetic WebSo… ([72c1c0e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/72c1c0ede3067077c17d66581f845ff3b367abcd))
* **observability:** add on-call paging receivers and synthetic WebSocket probe ([00f0625](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/00f0625454a8bbfd5f352fddad3f462c88d82a70)), closes [#1492](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1492) [#1494](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1494)
* resolve multiple issues including structured events, upgrade path, pause mechanism, and frontend fix ([ba69458](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ba69458d3b19c4c78308ef82a8fd4bd4866663b3))
* resolve multiple issues including structured events, upgrade path, pause mechanism, and frontend fix ([5589f9e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5589f9e305a817830e3185a0b9ddc3b4de6ac77b))
* **risk:** add configurable CVaR/VaR auto-pause with notifications ([5389dbc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5389dbc0fcb39dd9e41f424dd04ca77d1c48b130))
* **risk:** add configurable CVaR/VaR auto-pause with notifications ([f80e17a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/f80e17ab5fd9d17cc3485656d36b99a83e52278a))
* **security:** add contract audit checklist and self-audit report ([990ffa0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/990ffa0ba33a279ab43b13452dcda3a3a387bbf0))
* **security:** add contract audit checklist and self-audit report ([d95963c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d95963cc65fedac443b184ac97b16396d86f3c7c)), closes [#1026](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1026)
* **stellar-portfolio-rebalancer:** security-security-review-re-entrancy-risk-of-ext ([165c1df](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/165c1dfd02f807a2b9e883e4503be4f91af65ecf))
* **testing:** add backend integration tests for rebalance job queue ([6ec17f2](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6ec17f2194082f545b4b5f234745c28e9e67fd4f))
* **testing:** add backend integration tests for rebalance job queue ([4dcd9f8](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4dcd9f85bf2083f48183f9c8fa669e82f8b73284)), closes [#1048](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1048)


### Bug Fixes

* add admin auth to all debug routes, reduce info leakage ([4a91c29](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4a91c298838d559b3d285b8444973b56a9e16056)), closes [#1521](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1521)
* add CORS policy, API deprecation, DB pool config, and Zod validation ([e7c41fc](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e7c41fc7c844786d84f9ce471606f2ee53c5e6ab)), closes [#883](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/883) [#882](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/882) [#881](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/881) [#879](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/879)
* add keyboard accessibility to LanguageSelector and fix es/pt pluralization ([980c52b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/980c52b463db5144e8e1baa9bf4cc9a49bc420a5))
* add missing rebalance-status endpoint with correct timestamp ([02201ad](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/02201adec2f9377fabd4ead973a7989654313ddf))
* add missing rebalance-status endpoint with correct timestamp ([5c0e2bf](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/5c0e2bfe93c5edb74a16422250bc8844f214841e))
* address CodeRabbit review comments and resolve contract build/frontend test failures ([0fc063b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0fc063bcca7888547218377765eed711252ca92d))
* address CodeRabbit review findings ([9bee660](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9bee660164f96bc838c19b5a10854d43c8f768a6))
* **backend:** sync package-lock.json with package.json ([0b3ca5c](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0b3ca5c47f1c2d8c4d1d82dd7bcf2476dc31ee8f))
* **chaos:** address code review issues in kill-backend-mid-rebalance script ([9bda9b6](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9bda9b6e214396cdf7fc09ad3123cf718c50a25f))
* **ci:** fix three broken workflow scripts ([a07e029](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a07e029cec13dcd8e387e2733efa802b743dae6d))
* configurable CORS, API deprecation, DB pool exhaustion, Zod validation ([195243a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/195243aafe57b3b2f9ca4a9b8b7366f258c23d46))
* **contracts:** align rebalance execution with drift preview thresholds ([36b8e61](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/36b8e61d4d4bc619b864b3972b0066f8a9b237ef))
* **contracts:** resolve compilation, add testnet integration tests ([b13d6eb](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/b13d6ebbc0e8b97a2359acc5116722e29c486531)), closes [#964](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/964)
* correct consent CASE logic and remove PII from logs ([1b0022f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1b0022fb1f9b3a70de90f9c959b8d914feada439))
* **db:** read back stored portfolio name and description ([7c20d97](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7c20d97b8154c34bb3695f257cd5b5b75a660e4e))
* **deployment:** harden contract promotion ([9364e3d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9364e3dfd23c84e6d7b3f42568ca5049f3f456c8))
* **deps:** sync backend and frontend lockfiles for CI ([770c47f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/770c47f3cce538a468f3e034400228d34eb43026))
* enforce template size and registry limits per CodeRabbit review ([ce11d3f](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ce11d3f739daf0d421eb49bc5783b22fb0977e34))
* enforce two-decimal precision on percentage inputs before bps conversion ([89b7041](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/89b7041f4bc7a4e3d290fb2bf788f3c5b5dc0cc9))
* **frontend:** harden portfolio suggestions ([c326c88](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/c326c88113b70a1a32f94d8b210a34aac1bfe89b))
* **frontend:** remove stray xml tags from Modal.tsx ([ba8c6ac](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/ba8c6ac109bf44468f28b05f04de685da39f6882))
* **frontend:** scope portfolio suggestion test ([9a1e49b](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/9a1e49bb9ef9deb9d1efe20668a950eafcd9b0ca))
* guard against zero TWAP window records in circuit breaker ([a98e1de](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a98e1de1880399379cfb482e04df58d56ef95fe7))
* guard against zero TWAP window records in circuit breaker ([fd093b4](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fd093b4d7caf72667332f4d76f08b5a87a19841b))
* implement focus-trap accessibility in Modal component ([35c31c5](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/35c31c52c5fef2d0e3cf1e6967dfbcae3a677a87)), closes [#1481](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1481)
* populate new Portfolio fields in template storage-footprint check ([1d42e6d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/1d42e6d396a61a7348bcbf5332364673d03c7849))
* redact secrets from debug diagnostic payloads ([6ccca67](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6ccca67eeab48282e525f981d6aae97c68d1733d))
* remove corrupted XML tags and restore file integrity ([4577bba](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/4577bbaf9166091ab56e02feedd5cd2c7a0b1849))
* remove onClose from useEffect dependency array to prevent focus jumping ([0594109](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/0594109a66e76f2014a1935e1dac566750ac3bf3))
* resolve all blockers for portfolio import/export feature ([#893](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/893)) ([19ab8c1](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/19ab8c1e48cd0916d5213eef22e0bd04befb7ada))
* resolve merge conflicts and fix CI failures ([e09858d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e09858d053823e09178ef1e58d59ba57c5599381))
* resolve merge conflicts with upstream/main for stop-loss feature ([6c97c11](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/6c97c11de37aea7acb0340298be7a5b4e5e20a4d))
* resolve multiple portfolio rebalancer issues ([bbe6ef3](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bbe6ef3d97301efeb3db43c94cd27ec17a4cda4b))
* resolve multiple portfolio rebalancer issues ([fd1991a](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fd1991a8fef86d9782f1c97cbafbff5f32b96d60))
* resolve pre-existing source/test syntax errors and test mock issues ([fdeecb0](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/fdeecb0c9230b82dcad5ecfbbd51c03748535ec8))
* resolve pre-existing source/test syntax errors and test mock issues ([55e5479](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/55e547952aa76642c9d9e94454f04760e2f95d22))
* resolve Storybook peer dep conflicts and address review feedback ([873b38e](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/873b38eedc9d2171bbe75415f894d196b5109492))
* restore missing contract methods and event serialization from previous revert ([7a38c7d](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/7a38c7d41f709518c6fc72e4f53055df645d24e5))
* restore showRebalanceConfirm state in Dashboard.tsx ([a9af508](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/a9af508d5b046823502b8cba83994f964e8e7de8))
* **scope-idempotency-keys:** scope idempotency keys to authenticated user ([d946449](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/d9464498be52cb8ea0e344374f5c05ec0e36b5af)), closes [#1522](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1522)
* standardize error handler responses ([e3cf973](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/e3cf9735e5bffedb0dba3073037e4b5a92adee29))
* **theme:** remove unused vi import from test file ([bbf9128](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bbf9128c47138389a02e68eb77772f39dd875f9b))
* **theme:** subscribe to prefers-color-scheme changes and clean up listener on unmount ([#1464](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/1464)) ([bbfa707](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/bbfa707057b0f9139d352fc9f8b9fae5da4ca8c5))

## [Unreleased]

### Added

- Multi-portfolio dashboard summary endpoint `GET /api/v1/portfolios/summary?userAddress=ADDR` ([#974](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/974))
  - Returns `id`, `name`, `total_value_usd`, `drift_status`, and `last_rebalanced` for every portfolio belonging to one address in a single request, replacing one call per portfolio
  - Resolves prices once from the oracle cache and shares them across the whole response; an address with no portfolios skips the price lookup entirely and returns an empty array
  - `drift_status` is `ok`, `warning`, or `critical`, measured against each portfolio's own rebalance threshold

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

### Fixed

- Portfolio reads dropped the stored `name` and `description`: `rowToPortfolio` never mapped the two columns, so both came back undefined from every read path. A versioned `PUT /portfolio/:id` then merged that undefined over the stored row and wrote the name back as `NULL`, silently erasing it.

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
