#!/usr/bin/env bash
# cloudfront-invalidate.sh — Invalidate CloudFront paths after a frontend deploy.
#
# Usage:
#   CLOUDFRONT_DISTRIBUTION_ID=E1ABC... bash deployment/scripts/cloudfront-invalidate.sh
#
# Optional env vars:
#   INVALIDATION_PATHS   Space-separated list of paths to invalidate.
#                        Defaults to "/*" (full invalidation).
#   SMOKE_CHECK_URL      If set, curl-checks this URL after the invalidation
#                        completes and exits 1 if the response is not 2xx.
#   INVALIDATION_TIMEOUT Seconds to wait for the invalidation to complete.
#                        Defaults to 300.
#
# The script exits non-zero if:
#   - The invalidation request fails
#   - AWS reports the invalidation as anything other than Completed
#   - The optional smoke check returns a non-2xx HTTP status
#
# This script is wired into the frontend deploy pipeline to ensure users see
# updated content immediately after an S3 upload, rather than serving stale
# cached assets. Deploy pipelines fail loudly here rather than silently
# serving stale content (#1486).
set -euo pipefail

print_step() {
  printf '\n[%s] %s\n' "cloudfront-invalidate" "$1"
}

fail() {
  printf '[%s] ERROR: %s\n' "cloudfront-invalidate" "$1" >&2
  exit 1
}

CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
INVALIDATION_PATHS="${INVALIDATION_PATHS:-/*}"
SMOKE_CHECK_URL="${SMOKE_CHECK_URL:-}"
INVALIDATION_TIMEOUT="${INVALIDATION_TIMEOUT:-300}"

if [ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  fail "CLOUDFRONT_DISTRIBUTION_ID is required. Export it from the Terraform s3_cloudfront module output 'cloudfront_distribution_id'."
fi

if ! command -v aws &>/dev/null; then
  fail "aws CLI is not installed or not on PATH"
fi

# Build the paths array for the AWS CLI call.
# INVALIDATION_PATHS may be "/* /index.html" (space-separated).
read -ra PATHS_ARRAY <<< "$INVALIDATION_PATHS"
PATHS_COUNT="${#PATHS_ARRAY[@]}"

print_step "Requesting invalidation on distribution $CLOUDFRONT_DISTRIBUTION_ID"
printf '  Paths (%d): %s\n' "$PATHS_COUNT" "$INVALIDATION_PATHS"

CALLER_REF="deploy-$(date +%s)-$$"

INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "${PATHS_ARRAY[@]}" \
  --query 'Invalidation.Id' \
  --output text)"

if [ -z "$INVALIDATION_ID" ]; then
  fail "create-invalidation returned an empty invalidation ID"
fi

printf '[%s] Invalidation created: %s\n' "cloudfront-invalidate" "$INVALIDATION_ID"

print_step "Waiting for invalidation $INVALIDATION_ID to complete (timeout ${INVALIDATION_TIMEOUT}s)"

DEADLINE=$(( $(date +%s) + INVALIDATION_TIMEOUT ))
while true; do
  STATUS="$(aws cloudfront get-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --id "$INVALIDATION_ID" \
    --query 'Invalidation.Status' \
    --output text)"

  printf '[%s] Status: %s\n' "cloudfront-invalidate" "$STATUS"

  if [ "$STATUS" = "Completed" ]; then
    break
  fi

  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    fail "Timed out after ${INVALIDATION_TIMEOUT}s waiting for invalidation $INVALIDATION_ID (last status: $STATUS)"
  fi

  sleep 10
done

print_step "Invalidation $INVALIDATION_ID completed"

if [ -n "$SMOKE_CHECK_URL" ]; then
  print_step "Running smoke check against $SMOKE_CHECK_URL"

  HTTP_STATUS="$(curl -o /dev/null -s -w '%{http_code}' \
    --max-time 15 \
    --retry 3 \
    --retry-delay 5 \
    "$SMOKE_CHECK_URL")"

  printf '[%s] CDN smoke check HTTP status: %s\n' "cloudfront-invalidate" "$HTTP_STATUS"

  if [[ "$HTTP_STATUS" != 2* ]]; then
    fail "Smoke check failed: expected 2xx from $SMOKE_CHECK_URL but got $HTTP_STATUS"
  fi

  printf '[%s] Smoke check passed\n' "cloudfront-invalidate"
fi

printf '\n[%s] CloudFront invalidation complete for distribution %s\n' \
  "cloudfront-invalidate" "$CLOUDFRONT_DISTRIBUTION_ID"
