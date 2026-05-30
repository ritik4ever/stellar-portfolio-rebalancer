# Release Checklist

Use this template for contract, backend, and frontend releases. Fill in the release metadata first, then work through each section in order.

## Release metadata

- Version:
- Release owner:
- Target environment:
- Planned window:
- Issue or PR reference:
- Rollback owner:

## Supply chain

- [ ] Confirm the build workflow produced the latest frontend and backend bundles.
- [ ] Confirm SBOM artifacts were generated for frontend, backend, and contracts.
- [ ] Confirm artifact attestations were created for the release bundles.
- [ ] Review `npm run audit:policy` output and record any accepted exceptions.

## Contract artifacts

- [ ] Build the contract with `cd contracts && make build`.
- [ ] Verify the generated WASM artifact matches the intended release commit.
- [ ] Confirm the contract SBOM is attached to the CI run or release artifacts.
- [ ] Record the deployed contract address and network.

## Backend deploy

- [ ] Confirm the backend environment variables are set for the target environment.
- [ ] Run or approve database migrations for the release.
- [ ] Deploy the backend bundle and confirm the runtime starts cleanly.
- [ ] Verify `/health`, `/api/health`, and `/ready` after rollout.

## Frontend rollout

- [ ] Deploy the frontend bundle.
- [ ] Confirm the browser bundle corresponds to the attested build artifact.
- [ ] Verify the primary user flows after rollout.

## Post-release verification

- [ ] Check logs for startup or dependency warnings.
- [ ] Confirm alerts are quiet or explain any expected noise.
- [ ] Record the release outcome, including any temporary exceptions.
- [ ] Capture follow-up work for anything deferred during the release.
