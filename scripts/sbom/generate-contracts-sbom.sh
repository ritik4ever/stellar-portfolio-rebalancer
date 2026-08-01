#!/usr/bin/env bash
# scripts/sbom/generate-contracts-sbom.sh
#
# Generate a CycloneDX 1.5 JSON SBOM for the Rust contracts crate using
# `cargo-cyclonedx`. Writes to security/sbom/contracts.cdx.json relative to
# the repository root so the same path is produced locally and on CI.
#
# Requires: cargo, cargo-cyclonedx subcommand on PATH.
#
# Usage:
#   scripts/sbom/generate-contracts-sbom.sh
#
# Exit non-zero on any error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/security/sbom"
OUT_FILE="${OUT_DIR}/contracts.cdx.json"

SPEC_VERSION="${CYCLONEDX_SPEC_VERSION:-1.5}"

if ! command -v cargo >/dev/null 2>&1; then
    echo "[sbom] ::error:: cargo is not on PATH." >&2
    exit 1
fi

if ! cargo cyclonedx --version >/dev/null 2>&1; then
    echo "[sbom] ::error:: cargo-cyclonedx not installed. Run scripts/sbom/install-tools.sh first." >&2
    exit 1
fi

mkdir -p "${OUT_DIR}"

echo "[sbom] Generating contracts SBOM (CycloneDX ${SPEC_VERSION}, JSON)"
cd "${REPO_ROOT}/contracts"
trap 'cd "${REPO_ROOT}"' EXIT   # reset PWD on exit so callers don't inherit a wrong cwd

# `--target wasm32-unknown-unknown` keeps any `[target.'cfg(wasm32)'.dependencies]`
# conditional dependencies picked up correctly. The tool writes beside the crate;
# move the generated file to the repository's shared artifact directory afterward.
cargo cyclonedx \
    --target wasm32-unknown-unknown \
    --spec-version "${SPEC_VERSION}" \
    --format json \
    --override-filename contracts

mv contracts.json "${OUT_FILE}"

if [[ ! -s "${OUT_FILE}" ]]; then
    echo "[sbom] ::error:: generated SBOM file is missing or empty: ${OUT_FILE}" >&2
    exit 1
fi

echo "[sbom] Contracts SBOM written: ${OUT_FILE}"
echo "[sbom] Size: $(wc -c < "${OUT_FILE}") bytes"
