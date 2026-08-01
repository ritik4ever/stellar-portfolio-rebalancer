#!/usr/bin/env bash
# scripts/sbom/generate-all.sh
#
# Generate CycloneDX 1.5 JSON SBOMs for every tracked package (contracts, backend,
# frontend) in one shot. Exits non-zero on the first failed ecosystem so callers
# (CI and `npm run sbom`) see a clear failure locus.
#
# Usage:
#   scripts/sbom/generate-all.sh                  # capture tooling failures
#   scripts/sbom/install-tools.sh && ./generate-all.sh   # first-install path
#
# Exit non-zero on any error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=================================================="
echo "[sbom] Generating SBOMs for contracts, backend, frontend"
echo "=================================================="

bash "${SCRIPT_DIR}/install-tools.sh"
echo

bash "${SCRIPT_DIR}/generate-contracts-sbom.sh"
echo

bash "${SCRIPT_DIR}/generate-backend-sbom.sh"
echo

bash "${SCRIPT_DIR}/generate-frontend-sbom.sh"
echo

echo "=================================================="
echo "[sbom] All SBOMs generated. Contents of security/sbom/:"
ls -la "${SCRIPT_DIR}/../../security/sbom/"
echo "=================================================="
