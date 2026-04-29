#!/usr/bin/env bash
set -euo pipefail

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

OFFENDING_FILES=()
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  if [[ "${file}" == *".db-wal" ]] || [[ "${file}" == *".db-shm" ]] || [[ "${file}" == backend/data/*.db ]] || [[ "${file}" == backend/data/*.db-wal ]] || [[ "${file}" == backend/data/*.db-shm ]] || [[ "${file}" == playwright-report/* ]] || [[ "${file}" == */playwright-report/* ]] || [[ "${file}" == test-results/* ]] || [[ "${file}" == */test-results/* ]] || [[ "${file}" == coverage/* ]] || [[ "${file}" == */coverage/* ]] || [[ "${file}" == .nyc_output/* ]] || [[ "${file}" == */.nyc_output/* ]]; then
    OFFENDING_FILES+=("${file}")
  fi
done <<< "${CHANGED_FILES}"

if [[ "${#OFFENDING_FILES[@]}" -gt 0 ]]; then
  echo "Generated/runtime artifacts are not allowed in tracked changes:"
  printf '%s\n' "${OFFENDING_FILES[@]}"
  exit 1
fi

if [[ "${CHANGED_FILES}" == *"backend/openapi.json"* ]]; then
  if [[ "${CHANGED_FILES}" != *"backend/src/api/spec.ts"* ]]; then
    echo "Detected change to backend/openapi.json without backend/src/api/spec.ts."
    echo "If this file is generated, regenerate from source or exclude it from the PR."
    exit 1
  fi
fi

echo "Generated artifact guard passed."
