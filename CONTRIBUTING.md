# Contributing to Stellar Portfolio Rebalancer

Thanks for your interest in contributing!

The full contributor setup guide is at **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**.

It covers:

- Minimum local setup (backend + frontend)
- Optional services: PostgreSQL, Redis, SMTP
- Database migrations (PostgreSQL and SQLite paths)
- Running backend and frontend tests
- OpenAPI maintenance (`cd backend && npm run openapi:export` and `npm run api:validate` — see [backend/docs/openapi.md](backend/docs/openapi.md))
- Queue worker setup and expectations
- Frontend E2E tests with Playwright
- Contract build and deploy steps
- Key repo terms and glossary definitions
- Common setup failures and fixes
- Changelog workflow (`npm run changelog:update`)
- Architecture Decision Records (ADRs) at [docs/adr/](docs/adr/README.md)


For a quick overview of the API contract see [API.md](API.md). Background services and troubleshooting are covered in [docs/OPERATIONS.md](docs/OPERATIONS.md). Feature flags are summarized in [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md), and Soroban event shapes for the indexer are in [docs/CONTRACT_EVENTS.md](docs/CONTRACT_EVENTS.md).

**For Maintainers:** See [docs/TRIAGE.md](docs/TRIAGE.md) for issue and PR triage procedures.

## Workflow

1. **Check existing issues** or [create a new one](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new/choose) using our issue templates
2. Fork the repository and create a feature branch: `git checkout -b feature/your-feature`
3. Review the key project terms in [docs/GLOSSARY.md](docs/GLOSSARY.md)
4. Follow the setup guide in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
5. Make your changes and ensure all tests pass: `cd backend && npm test && cd ../frontend && npm test`
6. Open a pull request targeting `main` (reference the issue with "Closes #123")

## Terminology

Read [docs/GLOSSARY.md](docs/GLOSSARY.md) early in your onboarding process. It explains the language used by the backend, frontend, and Soroban contract interface, including:

- `Portfolio` / `portfolio_id`
- `Target allocation`, `Rebalance threshold`, `Slippage tolerance`
- `Reflector oracle`
- `Emergency stop` and `Cooldown period`

This helps contributors complete the workflow without needing to read source code first.

> **Before you open a PR**, review the [Branch Protection & Required Checks](docs/BRANCH_PROTECTION.md) guide to understand which CI checks must pass before your PR can be merged.

## Issue Templates

We provide templates for common contribution types:

- **Bug Report** - Report unexpected behavior or errors
- **Feature Request** - Suggest new features or enhancements
- **Rebalancing Strategy** - Propose new rebalancing strategies
- **Documentation** - Report or fix documentation issues
- **Operations** - Infrastructure or deployment concerns
- **Security** - Report security vulnerabilities (use private disclosure for critical issues)

[Create an issue →](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new/choose)

## For Maintainers

If you're a maintainer, see the [Maintainer Triage Guide](docs/TRIAGE.md) for how to label, prioritize, and respond to issues and pull requests.

## Database Migrations

### Migration System

Migrations use a versioned pattern with `.up.sql` and `.down.sql` file pairs:

```
backend/src/db/migrations/
├── 001_initial_schema.up.sql
├── 001_initial_schema.down.sql
├── 002_seed_demo_data.up.sql
├── 002_seed_demo_data.down.sql
└── manifest.json  # Checksums for integrity verification
```

### Migration Integrity Testing

Every PR that touches `backend/src/db/migrations/` runs an automated round-trip test to ensure:

1. **Migrations are reversible** - All `.down.sql` files successfully undo changes
2. **Migrations are idempotent** - Applying migrations again yields the same schema
3. **Schema state is preserved** - Database schema before and after rollback cycle is identical

**The test procedure:**

```
Apply migrations → Dump schema → Rollback all → Apply again → Dump schema → Compare
```

**Local testing:**

```bash
cd backend

# Apply all migrations
npm run db:migrate

# Check migration status
npm run db:migrate -- --status

# Run full round-trip test (slow but thorough)
npm run test:migrations

# Dump current schema (for manual inspection)
npm run db:schema:dump

# Rollback last N migrations
npm run db:migrate -- --rollback 1
```

**CI behavior:**

- Runs on all PRs and pushes touching migrations
- Uses fresh PostgreSQL database for clean state
- Fails immediately if any migration fails
- Reports schema differences with full diff output
- If rollback fails, CI stops at that step (fail fast)

**Writing reversible migrations:**

```sql
-- 003_add_users_table.up.sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

```sql
-- 003_add_users_table.down.sql
DROP TABLE users;
```

**Common issues:**

- **Data loss on rollback**: Down migrations should NOT delete data unless absolutely necessary. Use `DROP IF EXISTS` to be safe.
- **Circular dependencies**: Avoid foreign key constraints that would break rollback. Use deferred constraints if needed.
- **Type changes**: Changing column types can be tricky to roll back. Test locally first.

## Performance Testing

The backend includes automated performance testing using [clinic.js](https://clinicjs.org/) to detect memory leaks and performance regressions.

### Memory Leak Detection

The CI pipeline runs a 5-minute load test under clinic.js profiling. The test:

1. **Runs for 5 minutes** with 10 concurrent workers making requests
2. **Profiles heap usage** to track memory growth
3. **Fails if heap grows > 50MB** during the test run
4. **Uploads clinic reports** as CI artifacts for analysis

**Local testing:**

```bash
cd backend
npm run build

# Baseline run (should pass)
npm run perf:baseline

# Test memory leak detection (intentional leak, should fail)
npm run test:memory-leak

# Analyze clinic report
npm run perf:analyze
```

**How it works:**

- Clinic.js doctor profile collects heap snapshots and traces throughout the test
- Baseline runs establish normal heap behavior without memory leaks
- If heap growth exceeds 50MB, CI fails with detailed profiling data
- The clinic HTML report includes heap usage graphs for investigation

**To investigate failures:**

1. Download the `clinic-report` artifact from the failed CI run
2. Open the HTML file in a browser to see detailed heap graphs
3. Check for:
   - Rapid heap growth during test duration
   - Objects not being garbage collected
   - Circular references or event listener leaks

## Dependency Management

We use both [Dependabot](https://docs.github.com/en/code-security/dependabot) and [Renovate](https://www.renovatebot.com/) for comprehensive dependency management. Dependabot handles automatic merging while Renovate provides additional features and flexibility.

### Dependabot Configuration

Dependabot is configured in [.github/dependabot.yml](.github/dependabot.yml) for:

- **npm packages** (root, frontend, backend)
- **Cargo dependencies** (contracts)

**Update strategy:**
- **Patch updates**: Auto-approved and auto-merged after CI passes
- **Minor updates**: Create separate PRs for review (no auto-merge)
- **Major updates**: Create separate PRs, assigned to maintainers for review (no auto-merge)
- **Security advisories**: Never auto-merged; always require explicit approval

**Auto-merge workflow:**
1. Dependabot creates a PR for patch version updates
2. GitHub Actions workflow validates the update type
3. Patch updates are auto-approved and auto-merged once CI passes
4. Major/minor updates and security fixes receive comments and await manual review

### Renovate Configuration

Renovate provides additional features in [renovate.json](renovate.json):

- **Patch updates**: Grouped into a single weekly batch PR (Monday at 3am UTC)
- **Minor updates**: Separate PRs (one per package)
- **Major updates**: Separate PRs (one per package, high priority review)
- **Node.js versions**: Major and minor only; patch versions handled separately
- **Rust toolchain**: Managed via rust-toolchain configuration
- **Vulnerability alerts**: Prioritized and labeled for immediate attention

### Handling Dependency PRs

**For patch updates (auto-merged):**
- Review is automated via CI
- Merges automatically once tests pass
- Monitor for any unexpected issues post-merge

**For minor/major updates or security fixes:**
- Review the changelog and breaking changes
- Run tests locally if concerned about compatibility
- Verify against usage in codebase
- Approve or request changes
- Maintainers can merge directly if CI passes

**Security updates:**
- Always require explicit review and approval
- Never auto-merged regardless of CI status
- Check security advisory details before approving

## Changelog Updates

When your changes should be visible to users or contributors, update the changelog before opening a PR:

1. **Automatic generation**: Run `npm run changelog:update` from the repository root to generate entries from conventional commits.
2. **Manual review**: Review `CHANGELOG.md` and adjust wording/grouping if needed.
3. **Unreleased section**: Keep newest entries in `## [Unreleased]` until release cut.
4. **Commit format**: Use [conventional commits](https://conventionalcommits.org/) for automatic changelog generation:
   - `feat(api): add new endpoint` → Added section
   - `fix(auth): resolve token issue` → Fixed section
   - `docs: update examples` → Not included (docs-only)
   - `BREAKING CHANGE:` in footer → Prominently documented

**Release workflow**: See [CHANGELOG.md](CHANGELOG.md#release-notes-workflow) for the complete release notes process and maintainer responsibilities.
