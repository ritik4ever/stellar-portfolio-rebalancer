# Release Checklist

This template covers the steps for releasing a new version of the Stellar Portfolio Rebalancer.

## Pre-Release

- [ ] All PRs targeting this release are merged to `main`
- [ ] `CHANGELOG.md` is updated with all changes since last release
- [ ] Version bumped in `package.json` (semver)
- [ ] `API.md` is updated if API changes were made
- [ ] Contracts are recompiled and WASM hashes recorded
- [ ] Backend and frontend build without errors: `npm run build`

## Release Process

1. [ ] Create `release/vX.Y.Z` branch from `main`
2. [ ] Run full test suite: `npm test`
3. [ ] Run lint: `npm run lint`
4. [ ] Verify Docker build: `docker compose build`
5. [ ] Tag the release: `git tag vX.Y.Z`
6. [ ] Push tag: `git push origin vX.Y.Z`

## Post-Release

- [ ] Publish GitHub Release with release notes
- [ ] Push Docker images to GHCR / Docker Hub
- [ ] Deploy to staging and verify health checks
- [ ] Deploy to production (if applicable)
- [ ] Announce release in project communication channels

## Hotfix Release

For urgent fixes, skip pre-release steps 2-3 and go straight to:
1. Create hotfix branch from the release tag
2. Apply the fix
3. Follow the Release Process above
4. Cherry-pick the fix back to `main`

## Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR** — Breaking API or contract changes
- **MINOR** — New features, backward compatible
- **PATCH** — Bug fixes and minor improvements
