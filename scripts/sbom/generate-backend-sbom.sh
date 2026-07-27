#!/usr/bin/env bash
# scripts/sbom/generate-backend-sbom.sh
#
# Generate a CycloneDX 1.5 JSON SBOM for the Node backend package using
# @cyclonedx/cyclonedx-npm. Writes to security/sbom/backend.cdx.json relative
# to the repository root.
#
# Requires: node, npm, and that `npm ci` (or equivalent) has been run so a
# package-lock.json is present. The cyclonedx tool reads from the lockfile so
# the SBOM stays reproducible across runs.
#
# Usage:
#   scripts/sbom/generate-backend-sbom.sh
#
# Exit non-zero on any error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/security/sbom"
OUT_FILE="${OUT_DIR}/backend.cdx.json"

# CycloneDX spec version pin. Defaults to 1.5 (the supported Rust tool version).
# we ship to the workflow artifacts). @cyclonedx/cyclonedx-npm ships with a
# 1.5 default so the explicit flag here matters — do not remove.
SPEC_VERSION="${CYCLONEDX_SPEC_VERSION:-1.5}"

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
    echo "[sbom] ::error:: node or npx is missing on PATH." >&2
    exit 1
fi

if [[ ! -f "${REPO_ROOT}/backend/package-lock.json" ]]; then
    echo "[sbom] ::error:: backend/package-lock.json missing; run 'npm ci' in backend/ first." >&2
    exit 1
fi

mkdir -p "${OUT_DIR}"

echo "[sbom] Generating backend SBOM (CycloneDX ${SPEC_VERSION}, JSON)"
cd "${REPO_ROOT}/backend"
trap 'cd "${REPO_ROOT}"' EXIT   # reset PWD on exit so callers don't inherit a wrong cwd

# Pin a major.minor so we don't pick up breaking changes silently. Bump in
# --omit dev captures the full production dependency
# tree (what is actually shipped); remove the flag to include devDependencies
# when auditors request the full inventory.
npx --yes --package "@cyclonedx/cyclonedx-npm@^1" -- \
    cyclonedx-npm \
        --spec-version "${SPEC_VERSION}" \
        --output-format JSON \
        --output-file "${OUT_FILE}" \
        --omit dev

if [[ ! -s "${OUT_FILE}" ]]; then
    echo "[sbom] ::error:: generated SBOM file is missing or empty: ${OUT_FILE}" >&2
    exit 1
fi

echo "[sbom] Backend SBOM written: ${OUT_FILE}"
echo "[sbom] Size: $(wc -c < "${OUT_FILE}") bytes"
