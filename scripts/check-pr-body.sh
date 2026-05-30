#!/usr/bin/env bash
#
# check-pr-body.sh
#
# Validates that a Pull Request body either:
#   (A) References a GitHub issue — shorthand (#NNN) or a full GitHub
#       issue URL (https://github.com/<owner>/<repo>/issues/NNN), with
#       or without a closing keyword (Closes, Fixes, Resolves, Refs, etc.)
#   (B) Contains an explicit no-issue rationale keyword
#       (e.g. "No issue: dependency bump")
#
# If neither path matches the check exits 1 with a prescriptive error
# message that tells the contributor exactly how to fix the problem
# without pushing a new commit.
#
# ── Security notes ────────────────────────────────────────────────────
# • The PR body is NEVER passed via a shell argument or inline context
#   expansion. The caller (pr-issue-trail.yml) writes it to a temp file
#   using an env: variable and printf '%s', then passes the FILE PATH
#   here. This prevents shell injection from malicious PR bodies.
#
# • HTML/Markdown comment blocks (<!-- ... -->) are stripped from the
#   body BEFORE any regex runs. This prevents template placeholder text
#   that lives inside comment markers from producing a false-positive.
#
# ── Usage ─────────────────────────────────────────────────────────────
#   check-pr-body.sh <body-file> [labels-file]
#
#   <body-file>    Path to a file containing the raw PR body text.
#   [labels-file]  Optional. Path to a file containing a JSON array of
#                  label names currently applied to the PR. When the
#                  array includes "skip-issue-check" the script exits 0
#                  immediately (maintainer escape hatch).
#
# ── Exit codes ────────────────────────────────────────────────────────
#   0  PR body passes validation (or escape hatch triggered)
#   1  PR body fails validation
#   2  Usage / argument error

set -euo pipefail

# ── Argument validation ───────────────────────────────────────────────

BODY_FILE="${1:-}"
LABELS_FILE="${2:-}"

if [[ -z "${BODY_FILE}" ]]; then
  echo "::error::Usage: check-pr-body.sh <body-file> [labels-file]" >&2
  exit 2
fi

if [[ ! -f "${BODY_FILE}" ]]; then
  echo "::error::PR body file not found: ${BODY_FILE}" >&2
  exit 2
fi

# ── Step 1: Maintainer escape hatch (skip-issue-check label) ─────────
#
# Only maintainers with write access to the repository can apply labels,
# so this cannot be self-granted by external contributors.

if [[ -n "${LABELS_FILE}" && -f "${LABELS_FILE}" ]]; then
  if grep -qi '"skip-issue-check"' "${LABELS_FILE}"; then
    echo "✓ 'skip-issue-check' label detected — bypassing issue link requirement."
    echo "  (Applied by a maintainer as an explicit override.)"
    exit 0
  fi
fi

# ── Step 2: Strip HTML/Markdown comments before validation ────────────
#
# PR templates use <!-- ... --> blocks for instructions. If these are
# left in the body, a contributor who never fills in the template could
# still match a keyword that exists only inside a comment placeholder.
# We erase all comment blocks first so only deliberately written text
# (outside comments) is evaluated.
#
# Handles both single-line and multi-line comment blocks via two-pass sed:
#   Pass 1: Remove comments that open and close on the same line.
#   Pass 2: Remove multi-line comments by joining the body into one stream
#           and deleting everything between <!-- and -->.

CLEANED_BODY="$(
  sed 's/<!--[^-]*\(--\?[^->][^-]*\)*-->//g' "${BODY_FILE}" \
  | sed ':a;N;$!ba;s/<!--.*-->//g'
)"

# Bail early on a completely empty body after stripping.
if [[ -z "$(echo "${CLEANED_BODY}" | tr -d '[:space:]')" ]]; then
  CLEANED_BODY=""
fi

# ── Step 3: Path A — Issue link detection ─────────────────────────────
#
# Matches any of the following forms (case-insensitive):
#
#   Keyword + shorthand:  "Closes #42", "Fixes #7", "Resolves #100"
#   Keyword + full URL:   "Fixes https://github.com/org/repo/issues/42"
#   Bare shorthand:       "#42" anywhere in the body
#   Bare full URL:        "https://github.com/org/repo/issues/42"
#
# The keyword list covers the GitHub auto-close keywords plus common
# informal references (refs, references, related to).

PATH_A_KEYWORDS='(closes?|fixes?|resolves?|refs?|references?|related[ \t]+to)'
PATH_A_SHORTHAND='#[0-9]+'
PATH_A_FULL_URL='https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[0-9]+'

# Combined pattern: keyword + (shorthand or URL), OR bare shorthand, OR bare URL
PATH_A_PATTERN="${PATH_A_KEYWORDS}[ \t]+(${PATH_A_SHORTHAND}|${PATH_A_FULL_URL})|${PATH_A_SHORTHAND}|${PATH_A_FULL_URL}"

if echo "${CLEANED_BODY}" | grep -qiE "${PATH_A_PATTERN}"; then
  echo "✓ PR body contains a valid issue reference (Path A)."
  exit 0
fi

# ── Step 4: Path B — Explicit rationale keyword detection ─────────────
#
# Contributors who intentionally open a PR without a backing issue must
# include one of these keywords to pass the check. The PR template
# prompts "No issue: <rationale>" as the canonical form.

PATH_B_PATTERN='(no[- ]?issue|standalone|rationale|reason:|intentionally[- ]?no[- ]?issue)'

if echo "${CLEANED_BODY}" | grep -qiE "${PATH_B_PATTERN}"; then
  echo "✓ PR body contains an explicit no-issue rationale (Path B)."
  exit 0
fi

# ── Step 5: Failure — print prescriptive error and exit 1 ─────────────

cat <<'EOF'

✗ PR body does not link an issue or provide a rationale.

The CI check requires ONE of the following to appear in the PR
description (outside of <!-- HTML comment --> blocks):

  ── OPTION 1: Link a GitHub Issue ────────────────────────────────────
  Use a closing keyword + issue number (shorthand or full URL):

    Closes #42
    Fixes #7
    Resolves #1001
    Refs #300
    Related to #88

  Or a full GitHub issue URL:

    Closes https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/42
    Fixes  https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/7

  Or a bare reference anywhere in the body:

    #42
    https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/42

  ── OPTION 2: Declare no issue with a brief rationale ────────────────
  Start a line with "No issue:" followed by a one-sentence explanation:

    No issue: dependency bump — no associated feature request
    No issue: typo fix in README, trivial change

  Other accepted keywords: "standalone", "rationale:", "reason:",
  "intentionally no issue".

  ── HOW TO FIX ───────────────────────────────────────────────────────
  1. Open the PR in the GitHub UI.
  2. Click "Edit" on the PR description.
  3. Add one of the formats above (OUTSIDE any <!-- comment --> blocks).
  4. Save — the 'pr-issue-trail' check re-runs automatically.
     No new commit is required.

  ── MAINTAINER OVERRIDE ──────────────────────────────────────────────
  If this PR intentionally bypasses the check, a maintainer can apply
  the 'skip-issue-check' label to the PR. The check will be skipped on
  the next run.

See docs/CONTRIBUTING.md § "Pull Request Requirements" for full details.

EOF

exit 1
