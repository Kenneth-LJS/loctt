#!/usr/bin/env bash
# Manual smoke test: runs the bundled CLI binary through the same lifecycle
# E2E journey #1 covers, against a throwaway tmpdir. Useful for sanity-checking
# a freshly-built binary without spinning up the full Vitest suite.
#
# Mirrors tests/e2e/01-init-and-lifecycle.test.ts. If you change one, change
# the other.
#
# Usage:
#   tests/scripts/smoke.sh                  # uses the just-built binary
#   tests/scripts/smoke.sh /path/to/loctt   # smoke against a specific binary
#
# Exits 0 on full pass. Non-zero with a clear message on first failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCTT="${1:-$REPO_ROOT/apps/cli/dist/index.js}"

if [[ ! -f "$LOCTT" ]]; then
  echo "loctt binary not found at $LOCTT" >&2
  echo "run 'npm run build' first, or pass a path to a built binary as the first argument." >&2
  exit 1
fi

WORKSPACE="$(mktemp -d)"
trap 'rm -rf "$WORKSPACE"' EXIT

# Run the binary through Node directly (no #! shebang dependency).
loctt() {
  node "$LOCTT" "$@"
}

cd "$WORKSPACE"

assert_contains() {
  local haystack="$1" needle="$2" desc="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $desc" >&2
    echo "  expected output to contain: $needle" >&2
    echo "  got: $haystack" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" desc="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "FAIL: $desc" >&2
    echo "  expected output NOT to contain: $needle" >&2
    echo "  got: $haystack" >&2
    exit 1
  fi
}

step() {
  printf '  %s\n' "$1"
}

echo "loctt smoke test"
echo "  workspace: $WORKSPACE"
echo "  binary:    $LOCTT"
echo

step "init"
loctt init >/dev/null
[[ -f "$WORKSPACE/.loctt/config/workflow.yaml" ]] || { echo "FAIL: workflow.yaml missing" >&2; exit 1; }
[[ -f "$WORKSPACE/.loctt/config/queries.yaml"  ]] || { echo "FAIL: queries.yaml missing" >&2; exit 1; }

step "create T-1"
out="$(loctt create "task A")"
assert_contains "$out" "T-1" "create returns T-1"

step "create T-2"
out="$(loctt create "task B")"
assert_contains "$out" "T-2" "create returns T-2"

step "set T-1 status in_progress"
loctt set T-1 status in_progress >/dev/null
out="$(loctt show T-1)"
assert_contains "$out" "Status: in_progress" "show reflects status"

step "link T-1 blocks T-2"
loctt link T-1 blocks T-2 >/dev/null
out="$(loctt show T-2)"
assert_contains "$out" "is_blocked_by → T-1" "show T-2 surfaces inverse edge"

step "archive T-1"
loctt archive T-1 >/dev/null
out="$(loctt list)"
assert_not_contains "$out" "task A" "archived task hidden in list"
assert_contains     "$out" "task B" "non-archived task still listed"

step "log T-1"
out="$(loctt log T-1)"
assert_contains "$out" "created"     "log shows created entry"
assert_contains "$out" "status"      "log shows status field change"
assert_contains "$out" "link added"  "log shows link_added"
assert_contains "$out" "archived"    "log shows archived"

step "query status = in_progress"
loctt create "task C" >/dev/null
loctt set T-3 status in_progress >/dev/null
out="$(loctt list --query "status = in_progress")"
assert_contains     "$out" "task C" "query matches in_progress task"
assert_not_contains "$out" "task B" "query excludes other status"

echo
echo "OK: all smoke checks passed"
