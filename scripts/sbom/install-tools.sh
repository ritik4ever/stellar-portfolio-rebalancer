#!/usr/bin/env bash
# scripts/sbom/install-tools.sh
#
# Idempotently install the SBOM generation tools used by the other scripts/sbom/*
# helpers. cargo-cyclonedx is the Rust counterpart to @cyclonedx/cyclonedx-npm
# (npm/Node). The Node tool is invoked via `npx` on demand so we never need to
# pin a global install, but cargo-cyclonedx has to be on PATH for `cargo cyclonedx`.
#
# Usage:
#   scripts/sbom/install-tools.sh              # install cargo-cyclonedx only
#   CARGO_CYCLONEDX_VERSION=0.5.9 ./...        # override the pinned version
#
# Exit non-zero if any step fails so the calling CI step fails fast.

set -euo pipefail

# Pinned so CI runs are reproducible. Bump deliberately.
CARGO_CYCLONEDX_VERSION="${CARGO_CYCLONEDX_VERSION:-cargo-cyclonedx@0.5.9}"

echo "[sbom] Installing SBOM generation tools..."

if ! command -v cargo >/dev/null 2>&1; then
    echo "[sbom] ::error:: cargo is not on PATH; install Rust toolchain first." >&2
    exit 1
fi

if cargo cyclonedx --version >/dev/null 2>&1; then
    echo "[sbom] cargo-cyclonedx already installed:"
    cargo cyclonedx --version
else
    echo "[sbom] Installing cargo-cyclonedx via cargo install --locked ${CARGO_CYCLONEDX_VERSION}"
    # `cargo install <crate>@<version>` works since cargo 1.64
    cargo install --locked "${CARGO_CYCLONEDX_VERSION}"
    echo "[sbom] cargo-cyclonedx installed:"
    cargo cyclonedx --version
fi

# Node tool is invoked via npx per run (no global install), but verify Node + npx
# are present so the per-ecosystem scripts fail fast on missing toolchains.
if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
    echo "[sbom] ::error:: node/npx not on PATH; install Node.js before running sbom generation." >&2
    exit 1
fi

echo "[sbom] Node $(node --version), npm $(npm --version), npx $(npx --version)"
echo "[sbom] Tools ready."
