#!/usr/bin/env bash
#
# check-generated-artifacts.sh
#
# Pre-merge guard for generated outputs. It enforces two things:
#
#   A. Runtime/build artifacts must never be committed (databases, coverage,
#      Playwright reports, test-results, etc.).
#   B. Generated docs/code outputs must be FRESH — i.e. regenerating them from
#      source produces no diff. Today that means backend/openapi.json must match
#      what `npm run openapi:export` produces from backend/src/openapi/spec.ts.
#
# Usage:
#   scripts/check-generated-artifacts.sh [<base-ref>]
#     <base-ref>   git ref to diff against (default: origin/main)
#
# Environment:
#   SKIP_OPENAPI_FRESHNESS=1   skip the OpenAPI regenerate-and-diff check
#                              (the blocklist check still runs)
#
# Exit 0 when everything is clean; exit 1 when a runtime artifact is committed
# or a generated file is stale. Failures print the exact remediation command.

set -uo pipefail

BASE_REF="${1:-origin/main}"

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "Base ref '$BASE_REF' not found. Skipping generated artifact guard."
  exit 0
fi

CHANGED_FILES="$(git diff --name-only --diff-filter=ACMRT "${BASE_REF}...HEAD")"
if [[ -z "${CHANGED_FILES}" ]]; then
  CHANGED_FILES="$(git diff --name-only --diff-filter=ACMRT)"
fi

if [[ -z "${CHANGED_FILES}" ]]; then
  echo "No changed files found."
  exit 0
fi

# ---------------------------------------------------------------------------
# Part A — block committed runtime/build artifacts
# ---------------------------------------------------------------------------
OFFENDING_FILES=()
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  if [[ "${file}" == *".db-wal" ]] || [[ "${file}" == *".db-shm" ]] || [[ "${file}" == backend/data/*.db ]] || [[ "${file}" == backend/data/*.db-wal ]] || [[ "${file}" == backend/data/*.db-shm ]] || [[ "${file}" == playwright-report/* ]] || [[ "${file}" == */playwright-report/* ]] || [[ "${file}" == test-results/* ]] || [[ "${file}" == */test-results/* ]] || [[ "${file}" == coverage/* ]] || [[ "${file}" == */coverage/* ]] || [[ "${file}" == .nyc_output/* ]] || [[ "${file}" == */.nyc_output/* ]]; then
    OFFENDING_FILES+=("${file}")
  fi
done <<< "${CHANGED_FILES}"

if [[ "${#OFFENDING_FILES[@]}" -gt 0 ]]; then
  echo "✗ Generated/runtime artifacts are not allowed in tracked changes:"
  printf '  %s\n' "${OFFENDING_FILES[@]}"
  echo "  Remove them from the PR (they should be git-ignored)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Part B — verify generated OpenAPI export is fresh (no drift from source)
# ---------------------------------------------------------------------------
SPEC_SOURCE="backend/src/openapi/spec.ts"
SPEC_EXPORT="backend/openapi.json"

needs_openapi_check=false
case "${CHANGED_FILES}" in
  *"${SPEC_EXPORT}"*) needs_openapi_check=true ;;
esac
case "${CHANGED_FILES}" in
  *"${SPEC_SOURCE}"*) needs_openapi_check=true ;;
esac

if [[ "${needs_openapi_check}" == true && "${SKIP_OPENAPI_FRESHNESS:-0}" != "1" ]]; then
  if command -v npm >/dev/null 2>&1 && [[ -d backend/node_modules ]]; then
    echo "Verifying ${SPEC_EXPORT} is freshly generated from ${SPEC_SOURCE}…"
    if ! ( cd backend && npm run --silent openapi:export ); then
      echo "✗ Failed to regenerate ${SPEC_EXPORT} (npm run openapi:export errored)."
      exit 1
    fi
    if ! git diff --quiet -- "${SPEC_EXPORT}"; then
      echo "✗ ${SPEC_EXPORT} is out of date with ${SPEC_SOURCE}."
      echo "  Run: cd backend && npm run openapi:export   then commit the regenerated file."
      git --no-pager diff --stat -- "${SPEC_EXPORT}" || true
      exit 1
    fi
    echo "✓ ${SPEC_EXPORT} is fresh."
  else
    echo "… Backend dependencies not installed; skipping OpenAPI freshness regeneration."
    echo "  Verify locally with: cd backend && npm ci && npm run spec:check"
    echo "  (CI installs deps so the 'Generated Artifact Guard' job runs this check.)"
  fi
fi

echo "Generated artifact guard passed."
