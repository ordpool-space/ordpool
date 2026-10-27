#!/usr/bin/env bash
# Fails when fewer bitmap E2E tests passed than the committed floor in
# frontend/.e2e-count-baseline.json.
#
# A green Playwright run says nothing about how many tests it ran: specs
# that fall outside testMatch, or a testDir that points at the wrong
# folder, are simply never collected, and the run stays green. This counts
# the tests that actually passed and compares that number to the floor.
#
# Only an ordpool core maintainer lowers the floor, by editing the baseline
# file and committing that edit as an explicit decision. Every other drop
# is treated as an accident: restore the missing tests instead.
#
# Usage: check-count-floor.sh <results.json>
#   <results.json> is the output of Playwright's json reporter, which
#   playwright.config.ts writes when ORDPOOL_E2E_RESULTS_JSON is set.

set -euo pipefail

RESULTS="${1:?usage: check-count-floor.sh <results.json>}"
BASELINE_FILE="$(dirname "$0")/../../.e2e-count-baseline.json"

if [ ! -s "$RESULTS" ]; then
  echo "::error::No Playwright json results at $RESULTS; the suite did not report."
  exit 1
fi

# stats.expected counts the tests that passed. Retries are 0 in
# playwright.config.ts, so there is no flaky pass to add.
CURRENT=$(jq -r '.stats.expected' "$RESULTS")
BASELINE=$(jq -r '.passing' "$BASELINE_FILE")

if ! [[ "$CURRENT" =~ ^[0-9]+$ ]]; then
  echo "::error::Could not read stats.expected from $RESULTS (got '$CURRENT')."
  exit 1
fi
if ! [[ "$BASELINE" =~ ^[0-9]+$ ]]; then
  echo "::error::frontend/.e2e-count-baseline.json has no numeric 'passing' field (got '$BASELINE')."
  exit 1
fi

echo "Passing bitmap E2E tests: $CURRENT"
echo "Committed floor:          $BASELINE"

if [ "$CURRENT" -lt "$BASELINE" ]; then
  echo "::error::BITMAP E2E COVERAGE DROPPED. $CURRENT tests passed, the committed floor is $BASELINE ($((BASELINE - CURRENT)) missing)."
  echo ""
  echo "Only an ordpool core maintainer lowers the floor, by editing"
  echo "frontend/.e2e-count-baseline.json and committing that edit."
  echo ""
  echo "If you got here by accident (a spec outside testMatch, a renamed"
  echo "folder, a deleted or skipped test, a failing test), restore the"
  echo "missing tests instead."
  exit 1
fi

if [ "$CURRENT" -gt "$BASELINE" ]; then
  echo "::notice::Bitmap E2E count grew (+$((CURRENT - BASELINE)) over the floor). Raise frontend/.e2e-count-baseline.json to lock it in."
fi
