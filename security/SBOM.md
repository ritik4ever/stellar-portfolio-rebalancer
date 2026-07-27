# SBOM Generation & Consumption

This repository generates **CycloneDX 1.5 Software Bill of Materials (SBOM)** JSON files for every tracked package on every PR and release. SBOMs let auditors, compliance teams, and vulnerability scanners answer two questions at any time:

1. Exactly which versions of every dependency are in the binary a user is about to deploy?
2. Do any of those dependencies currently have a published advisory?

This document covers:

- Where SBOMs are produced.
- How the pipeline is wired.
- How to **regenerate** an SBOM locally.
- How to **consume** an SBOM for vulnerability scanning or compliance review.

---

## What gets generated

| Ecosystem | Tool                                       | Format                       | Output path (local + CI)         |
| :---       | :---                                       | :---                         | :---                             |
| Contracts  | [`cargo-cyclonedx`](https://github.com/CycloneDX/cyclonedx-rust-cargo) (cargo subcommand) | CycloneDX 1.5, JSON | `security/sbom/contracts.cdx.json` |
| Backend    | [`@cyclonedx/cyclonedx-npm`](https://www.npmjs.com/package/@cyclonedx/cyclonedx-npm) (CLI via `npx`) | CycloneDX 1.5, JSON | `security/sbom/backend.cdx.json`   |
| Frontend   | [`@cyclonedx/cyclonedx-npm`](https://www.npmjs.com/package/@cyclonedx/cyclonedx-npm) (CLI via `npx`) | CycloneDX 1.5, JSON | `security/sbom/frontend.cdx.json`  |

All three files are **regenerated per build**. They are intentionally **gitignored** so the repository stays small (see `.gitignore` → `/security/sbom/`).

> **Local development output:** identical path (`security/sbom/{ecosystem}.cdx.json`).
>
> **CI output:** identical path under the workflow workspace, **plus** uploaded as workflow artifacts `sbom-contracts`, `sbom-backend`, and `sbom-frontend` on every PR/push to `main` and every GitHub release. The `.cdx.json` extension follows the CycloneDX project convention so tooling can auto-detect the spec version.

---

## How the pipeline is wired

```text
PR opened / push to main / release cut
        │
        ▼
.github/workflows/sbom.yml ── installs both SBOM tools
        │
        ├─► bash scripts/sbom/install-tools.sh
        │       └─► cargo install cargo-cyclonedx (idempotent)
        │
        ├─► bash scripts/sbom/generate-contracts-sbom.sh     ─► security/sbom/contracts.cdx.json
        ├─► bash scripts/sbom/generate-backend-sbom.sh       ─► security/sbom/backend.cdx.json
        └─► bash scripts/sbom/generate-frontend-sbom.sh      ─► security/sbom/frontend.cdx.json
                                                            │
                                                            ▼
                                       actions/upload-artifact v4 (per ecosystem)
                                       GitHub workflow artifacts named sbom-{ecosystem}
```

Triggers:

- `pull_request` — every PR
- `push` to `main` — every merge to main
- `workflow_dispatch` — ad-hoc, useful for security investigations
- `release: published` — every GitHub Release cut by release-please

Permissions:

- `contents: read` — no token-write or attestation scope is required for SBOMs (those are still produced separately by `build.yml`).

---

## How to regenerate an SBOM locally

### One shot (all three ecosystems)

```bash
# from the repo root
npm run sbom
```

This wraps `scripts/sbom/generate-all.sh`, which is idempotent: it installs `cargo-cyclonedx` if missing, regenerates all three `.cdx.json` files under `security/sbom/`, and exits non-zero on the first failure.

### One ecosystem only

```bash
# Frontend only
bash scripts/sbom/generate-frontend-sbom.sh

# Backend only
bash scripts/sbom/generate-backend-sbom.sh

# Contracts only (needs Rust + cargo-cyclonedx)
bash scripts/sbom/install-tools.sh
bash scripts/sbom/generate-contracts-sbom.sh
```

You can override the CycloneDX spec version per run:

```bash
CYCLONEDX_SPEC_VERSION=1.5 bash scripts/sbom/generate-backend-sbom.sh
```

The default is **1.5**, the NTIA-recommended modern minimal version and the version we ship to the workflow artifacts.

### Verifying the toolchain

```bash
cargo cyclonedx --version           # cargo-cyclonedx
npx --yes @cyclonedx/cyclonedx-npm --version   # node tool
node --version                       # Node ≥ 20.19.0
rustc --version                      # Rust ≥ stable, with wasm32-unknown-unknown target
```

---

## How to consume an SBOM

### 1. From a CI run

Open the workflow run, scroll to **Artifacts**, and download:

- `sbom-frontend` → `frontend.cdx.json`
- `sbom-backend` → `backend.cdx.json`
- `sbom-contracts` → `contracts.cdx.json`

A given release PR's artifacts are available as long as GitHub retains the run (default 90 days; retention is configurable by maintainers).

### 2. From a released tag

When `release-please` cuts a tag, the SBOM workflow re-runs on `release: published`:

1. Open the release on GitHub.
2. Switch to the matching **SBOM Generation** workflow run.
3. Download the `sbom-{ecosystem}` artifact as above.

### 3. In CI locally

The same scripts run in CI; the output path is identical (`security/sbom/{ecosystem}.cdx.json`). You can rerun any individual generator against a fresh checkout and `git diff` the file to see what changed since the last run.

### 4. With downstream tools

Below are the **canonical recipes** for the most common consumers. All three SBOM files follow the same shape (CycloneDX 1.5, JSON), so any tool that supports CycloneDX 1.5 will accept them.

#### [OWASP Dependency-Track](https://dependencytrack.org/)

```bash
# Upload a single SBOM via REST API
curl -u "${DT_API_KEY}:" \
     -H "Content-Type: application/json" \
     --data @security/sbom/backend.cdx.json \
     "${DT_BASE_URL}/api/v1/bom"
```

For automated project creation, pair the upload with a `PUT /api/v1/project` call so the SBOM attaches to the right project UUID. Dependency-Track will then evaluate NVD, OSV, GHSA, and Sonatype feeds continuously against the uploaded BOM.

#### [Grype](https://github.com/anchore/grype) (local CLI scan)

```bash
# Grype reads CycloneDX JSON natively
grype sbom:./security/sbom/backend.cdx.json
grype sbom:./security/sbom/frontend.cdx.json

# Rust SBOM via cyclonedx-json + the grype rustdb
grype sbom:./security/sbom/contracts.cdx.json
```

Grype returns a rich vulnerability table with fixes and CVSS scores. Pipe `grype ... -o json` into your own reporting pipeline.

#### [Snyk](https://snyk.io/)

```bash
# Snyk CLI accepts CycloneDX JSON directly
snyk sbom --file=security/sbom/backend.cdx.json
snyk sbom --file=security/sbom/frontend.cdx.json
```

For the contracts SBOM, Snyk does not currently evaluate Rust SBOMs from CycloneDX; instead use `cargo audit` against the `Cargo.lock`, which is already wired into `contract-smoke.yml`.

#### [`bom-cli`](https://github.com/anchore/syft) / [Syft](https://github.com/anchore/syft) round-trip

```bash
# Verify a CycloneDX SBOM is structurally valid
syft attest --input sbom ./security/sbom/backend.cdx.json

# Convert to another format if your downstream tool needs SPdx
bom convert --input-format cyclonedx-json --output-format spdx-json \
    --input-file security/sbom/backend.cdx.json \
    > security/sbom/backend.spdx.json
```

#### Standalone validation (no third-party tool)

```bash
# jq one-liner — top-level shape sanity
jq '.bomFormat, .specVersion, .components | length' security/sbom/backend.cdx.json
```

Expected output:

```text
"CycloneDX"
"1.5"
<N>
```

---

## Operational notes

- **Reproducibility.** All three tools read from lockfiles (`Cargo.lock`, `backend/package-lock.json`, `frontend/package-lock.json`). Run `npm ci` and `cargo generate-lockfile` before generating if you have just changed dependencies.
- **Spec version pinning.** CycloneDX 1.5 is the default. Bumping the spec is a cross-cutting change and must be reviewed in `security/SBOM.md` plus the matching `npm run sbom` output.
- **Tree hygiene.** `security/sbom/` is gitignored. The `.gitignore` rule is `/security/sbom/` (scope-limited to the dir itself), so audit-policy and lockfiles under `security/` continue to be tracked. See [`docs/CONTRIBUTING.md`](../CONTRIBUTING.md) for the rest of the security-pipeline workflows.
- **Failure semantics.** Any non-zero exit from any per-ecosystem script fails the workflow. CI is therefore guaranteed to fail when a tool does not produce a parseable SBOM.
- **What this PR does not cover (yet).** Image-level SBOMs (Docker/OCI) and signed Software Bill of Materials are tracked separately under the [Disaster Recovery → Supply-chain](../DISASTER_RECOVERY.md) roadmap.

---

## Related

- [`.github/workflows/sbom.yml`](../../.github/workflows/sbom.yml) — the workflow that drives everything above.
- [`scripts/sbom/`](../scripts/sbom/) — the per-ecosystem generators and the `install-tools.sh` helper.
- [`scripts/README.md`](../scripts/README.md) — index of every maintenance script in the repo.
- [`docs/CONTRIBUTING.md`](../CONTRIBUTING.md) — section on dependency audit policy (orthogonal to SBOMs).
- [`docs/OPERATIONS.md`](../OPERATIONS.md) — release-time SBOM verification step.
- [`docs/RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md) — release checklist line item that references this file.
