#!/usr/bin/env bash
#
# check-commit-messages.sh
#
# Lightweight Conventional Commits policy check. Validates the subject line of
# every commit in a range against the format documented in docs/CONTRIBUTING.md:
#
#   <type>[optional scope][!]: <description>
#
# Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci,
#                chore, revert
#
# Usage:
#   scripts/check-commit-messages.sh [<range>]
#
#   <range>   A git revision range (e.g. origin/main..HEAD). When omitted, the
#             script falls back to BASE_SHA..HEAD_SHA from the environment, then
#             to origin/main..HEAD.
#
# Examples:
#   scripts/check-commit-messages.sh                 # check local branch vs origin/main
#   scripts/check-commit-messages.sh origin/main..HEAD
#   BASE_SHA=abc123 HEAD_SHA=def456 scripts/check-commit-messages.sh
#
# Exit code 0 when all commit subjects are valid, 1 otherwise.

set -euo pipefail

# Conventional Commits subject pattern. The description must be non-empty.
PATTERN='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?(!)?: .+'

# Resolve the commit range to inspect.
if [[ $# -ge 1 && -n "${1:-}" ]]; then
  RANGE="$1"
elif [[ -n "${BASE_SHA:-}" && -n "${HEAD_SHA:-}" ]]; then
  RANGE="${BASE_SHA}..${HEAD_SHA}"
else
  RANGE="origin/main..HEAD"
fi

echo "Validating commit messages in range: ${RANGE}"

# Collect commit hashes in the range. Use a here-string + while loop (portable
# to bash 3.2, e.g. the default macOS bash) instead of `mapfile` (bash 4+).
COMMITS="$(git rev-list --no-merges "${RANGE}")"

if [[ -z "${COMMITS}" ]]; then
  echo "No non-merge commits to validate."
  exit 0
fi

failed=0
while IFS= read -r sha; do
  [[ -z "${sha}" ]] && continue
  subject="$(git log -1 --format=%s "${sha}")"

  # Skip auto-generated revert/merge style subjects that git may produce.
  if [[ "${subject}" == Merge* ]]; then
    continue
  fi

  if [[ "${subject}" =~ ${PATTERN} ]]; then
    echo "  ✓ ${sha:0:8}  ${subject}"
  else
    echo "  ✗ ${sha:0:8}  ${subject}"
    failed=1
  fi
done <<< "${COMMITS}"

if [[ ${failed} -ne 0 ]]; then
  cat <<'EOF'

✗ One or more commit messages do not follow Conventional Commits.

Expected format:
  <type>[optional scope][!]: <description>

Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

Examples:
  feat(api): add portfolio export endpoint
  fix(auth): resolve JWT token expiration handling
  docs: update API client examples
  chore(deps): update stellar-sdk to v12.0.1

See docs/CONTRIBUTING.md (Commit message conventions) for details.
EOF
  exit 1
fi

echo "✓ All commit messages follow Conventional Commits."
