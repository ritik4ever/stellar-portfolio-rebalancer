#!/bin/bash
#
# manage-flaky-tests.sh
#
# Manage the flaky test quarantine registry.
# Source of truth: backend/src/test/flaky/quarantine.json
#
# Usage:
#   bash scripts/manage-flaky-tests.sh <command> [flags]
#
# Commands:
#   add       Quarantine a test (writes to quarantine.json)
#   remove    Re-enable a test (removes from quarantine.json)
#   list      Print all currently quarantined tests
#   validate  Check quarantine.json is structurally valid
#   report    Print a Markdown table (useful for PR descriptions)
#

set -euo pipefail

# Paths
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_PATH="${REPO_ROOT}/backend/src/test/flaky/quarantine.json"
SCHEMA_PATH="${REPO_ROOT}/backend/src/test/flaky/quarantine.schema.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper: print error and exit
error() {
  echo -e "${RED}ERROR${NC}: $*" >&2
  exit 1
}

# Helper: print warning
warn() {
  echo -e "${YELLOW}WARN${NC}: $*" >&2
}

# Helper: print info
info() {
  echo -e "${BLUE}INFO${NC}: $*" >&2
}

# Helper: ensure jq is available
require_jq() {
  if ! command -v jq &>/dev/null; then
    error "jq is required. Install it: brew install jq (macOS) or apt install jq (Linux)"
  fi
}

# Helper: check if registry exists and is valid JSON
check_registry_exists() {
  if [[ ! -f "$REGISTRY_PATH" ]]; then
    error "Registry not found at $REGISTRY_PATH"
  fi
  if ! jq empty "$REGISTRY_PATH" 2>/dev/null; then
    error "Registry is not valid JSON"
  fi
}

# Helper: validate a single entry against schema
validate_entry() {
  local id="$1"
  local entry
  entry=$(jq ".quarantined[] | select(.id == \"$id\")" "$REGISTRY_PATH")
  
  if [[ -z "$entry" ]]; then
    error "Entry with id '$id' not found in registry"
  fi

  # Check required fields
  for field in id file title reason issue owner quarantinedAt; do
    if ! echo "$entry" | jq -e ".$field" >/dev/null 2>&1; then
      error "Entry '$id' missing required field: $field"
    fi
  done

  # Validate issue is a URL
  local issue
  issue=$(echo "$entry" | jq -r '.issue')
  if [[ ! "$issue" =~ ^https?:// ]]; then
    error "Entry '$id' has invalid issue URL: $issue"
  fi

  # Check owner is not empty
  local owner
  owner=$(echo "$entry" | jq -r '.owner')
  if [[ -z "$owner" || "$owner" == "null" ]]; then
    error "Entry '$id' missing owner"
  fi

  # Check quarantinedAt is valid ISO date
  local quarantined_at
  quarantined_at=$(echo "$entry" | jq -r '.quarantinedAt')
  if ! date -d "$quarantined_at" >/dev/null 2>&1; then
    error "Entry '$id' has invalid quarantinedAt date: $quarantined_at"
  fi

  # Warn if quarantined > 30 days without reviewBy
  local quarantine_date
  quarantine_date=$(date -d "$quarantined_at" +%s)
  local now
  now=$(date +%s)
  local days_quarantined=$(( (now - quarantine_date) / 86400 ))
  
  local review_by
  review_by=$(echo "$entry" | jq -r '.reviewBy // empty')
  
  if [[ $days_quarantined -gt 30 && -z "$review_by" ]]; then
    warn "Entry '$id' has been quarantined for $days_quarantined days without a reviewBy date"
  fi

  # Warn if reviewBy is in the past
  if [[ -n "$review_by" ]]; then
    local review_date
    review_date=$(date -d "$review_by" +%s)
    if [[ $review_date -lt $now ]]; then
      warn "Entry '$id' has reviewBy date in the past ($review_by)"
    fi
  fi
}

# Command: add
cmd_add() {
  local id file title reason issue owner review_by
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="$2"; shift 2 ;;
      --file) file="$2"; shift 2 ;;
      --title) title="$2"; shift 2 ;;
      --reason) reason="$2"; shift 2 ;;
      --issue) issue="$2"; shift 2 ;;
      --owner) owner="$2"; shift 2 ;;
      --review-by) review_by="$2"; shift 2 ;;
      *) error "Unknown flag: $1" ;;
    esac
  done

  require_jq
  check_registry_exists

  # Validate required fields
  [[ -z "${id:-}" ]] && error "Missing required flag: --id"
  [[ -z "${file:-}" ]] && error "Missing required flag: --file"
  [[ -z "${title:-}" ]] && error "Missing required flag: --title"
  [[ -z "${reason:-}" ]] && error "Missing required flag: --reason"
  [[ -z "${issue:-}" ]] && error "Missing required flag: --issue"
  [[ -z "${owner:-}" ]] && error "Missing required flag: --owner"

  # Validate issue is a URL
  if [[ ! "$issue" =~ ^https?:// ]]; then
    error "Issue must be a valid URL: $issue"
  fi

  # Check if entry already exists
  if jq -e ".quarantined[] | select(.id == \"$id\")" "$REGISTRY_PATH" >/dev/null 2>&1; then
    error "Entry with id '$id' already exists. Use 'remove' first if you want to replace it."
  fi

  # Build new entry
  local today
  today=$(date +%Y-%m-%d)
  
  local new_entry
  new_entry=$(jq -n \
    --arg id "$id" \
    --arg file "$file" \
    --arg title "$title" \
    --arg reason "$reason" \
    --arg issue "$issue" \
    --arg owner "$owner" \
    --arg quarantined_at "$today" \
    '{id: $id, file: $file, title: $title, reason: $reason, issue: $issue, owner: $owner, quarantinedAt: $quarantined_at}')

  if [[ -n "${review_by:-}" ]]; then
    new_entry=$(echo "$new_entry" | jq --arg review_by "$review_by" '.reviewBy = $review_by')
  fi

  # Add to registry
  local updated_registry
  updated_registry=$(jq ".quarantined += [$new_entry]" "$REGISTRY_PATH")
  echo "$updated_registry" > "$REGISTRY_PATH"

  info "Added quarantine entry: $id"
  info "File: $file"
  info "Issue: $issue"
  info "Owner: $owner"
  validate_entry "$id"
}

# Command: remove
cmd_remove() {
  local id
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id) id="$2"; shift 2 ;;
      *) error "Unknown flag: $1" ;;
    esac
  done

  require_jq
  check_registry_exists

  [[ -z "${id:-}" ]] && error "Missing required flag: --id"

  # Check if entry exists
  if ! jq -e ".quarantined[] | select(.id == \"$id\")" "$REGISTRY_PATH" >/dev/null 2>&1; then
    error "Entry with id '$id' not found"
  fi

  # Remove from registry
  local updated_registry
  updated_registry=$(jq ".quarantined |= map(select(.id != \"$id\"))" "$REGISTRY_PATH")
  echo "$updated_registry" > "$REGISTRY_PATH"

  info "Removed quarantine entry: $id"
}

# Command: list
cmd_list() {
  require_jq
  check_registry_exists

  local count
  count=$(jq '.quarantined | length' "$REGISTRY_PATH")

  if [[ $count -eq 0 ]]; then
    echo "No quarantined tests"
    return 0
  fi

  echo "Currently quarantined tests ($count):"
  echo ""
  jq -r '.quarantined[] | "\(.id) — \(.file) — \(.title) — issue: \(.issue) — owner: \(.owner)"' "$REGISTRY_PATH"
}

# Command: validate
cmd_validate() {
  require_jq
  check_registry_exists

  local has_errors=0

  # Validate JSON structure
  if ! jq -e '.quarantined | type == "array"' "$REGISTRY_PATH" >/dev/null 2>&1; then
    error "Registry must have a 'quarantined' array"
  fi

  # Validate each entry
  local count
  count=$(jq '.quarantined | length' "$REGISTRY_PATH")

  for i in $(seq 0 $((count - 1))); do
    local id
    id=$(jq -r ".quarantined[$i].id" "$REGISTRY_PATH")
    
    if ! validate_entry "$id" 2>/dev/null; then
      has_errors=1
    fi
  done

  if [[ $has_errors -eq 0 ]]; then
    info "✓ Registry is valid"
  else
    error "Registry validation failed"
  fi
}

# Command: report
cmd_report() {
  require_jq
  check_registry_exists

  local count
  count=$(jq '.quarantined | length' "$REGISTRY_PATH")

  if [[ $count -eq 0 ]]; then
    echo "No quarantined tests"
    return 0
  fi

  echo "| Test ID | File | Owner | Issue | Reason | Review By |"
  echo "|---------|------|-------|-------|--------|-----------|"
  
  jq -r '.quarantined[] | 
    "| `" + .id + "` | `" + .file + "` | " + .owner + " | [" + (.issue | split("/")[-1]) + "](" + .issue + ") | " + .reason + " | " + (.reviewBy // "—") + " |"' \
    "$REGISTRY_PATH"
}

# Main
main() {
  local command="${1:-}"

  case "$command" in
    add)
      shift || true
      cmd_add "$@"
      ;;
    remove)
      shift || true
      cmd_remove "$@"
      ;;
    list)
      cmd_list
      ;;
    validate)
      cmd_validate
      ;;
    report)
      cmd_report
      ;;
    "")
      error "No command specified. Use: add, remove, list, validate, or report"
      ;;
    *)
      error "Unknown command: $command"
      ;;
  esac
}

main "$@"
