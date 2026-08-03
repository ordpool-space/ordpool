#!/usr/bin/env bash
#
# Guard against the "nLockTime=21 as protocol requirement on non-mint
# txs" framing bug. See workspace HQ HARD RULE:
#   "nLockTime=21 is PROTOCOL for MINT, CONVENTION for everything else"
# in /Users/johanneshoppe/Work/ordpool/CLAUDE.md.
#
# The bug: reviewers / AI agents keep writing comments that claim
# non-mint transactions (transfers, offer settles, bid settles) MUST
# have nLockTime=21 or the cat is "orphaned" / "burned" / "lost".
# That's false. A cat's identity is preserved by ordinal-theory sat
# tracking, not by locktime. A settle tx built by Xverse or Leather
# with locktime=0 still delivers the cat to the buyer; only the
# SDK/wallet's *bonus* mint is lost.
#
# We ban specific misleading phrases in the codebase. If any of the
# phrases below appear anywhere in tracked source / test / doc files,
# this script exits non-zero and prints the offending lines.
#
# Legitimate places to discuss the actual Xverse-Accelerate incident
# stay allowed: the incident IS a real risk in the mempool RBF window
# for a mint. The banned phrases are specifically the ones that would
# be false when applied to a non-mint transfer/settle. If you need to
# reference an incident, spell it out in full ("2024 Xverse-Accelerate
# mint-RBF incident") rather than shorthand that also reads as
# non-mint safety.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The banned phrases. Each one is a shell-glob-style needle passed to
# grep -F (fixed strings, not regex — the strings contain punctuation).
BANNED_PHRASES=(
  "orphans the cat"
  "orphan the cat"
  "burns the cat"
  "burn the cat"
  "buyer loses the cat"
  "leave the buyer without a cat21-recognized tx"
  "leaves the buyer without a cat21-recognized tx"
  "MUST survive the accept-offer settlement"
  "MUST survive the bid-marketplace settlement"
  "MUST survive the transfer"
  "MUST survive the settlement"
  "workspace HQ HARD RULE #1"
)

# Search scope: everything we author. Exclude build output, deps, and
# vendored bundles. Restrict to text file extensions we actually own.
INCLUDES=(
  "--include=*.ts"
  "--include=*.tsx"
  "--include=*.js"
  "--include=*.mjs"
  "--include=*.md"
  "--include=*.html"
  "--include=*.rs"
)
EXCLUDES=(
  "--exclude-dir=node_modules"
  "--exclude-dir=dist"
  "--exclude-dir=dist-core"
  "--exclude-dir=build"
  "--exclude-dir=target"
  "--exclude-dir=.next"
  "--exclude-dir=coverage"
  "--exclude-dir=.angular"
  "--exclude-dir=.git"
  # Vendored / bundled extensions the tests load — not our source.
  "--exclude-dir=extensions"
  # This script itself lists the banned phrases as data; don't self-match.
  "--exclude=check-locktime-framing.sh"
)

exit_code=0

for phrase in "${BANNED_PHRASES[@]}"; do
  # grep exits 1 when it finds nothing. That is success for us.
  # It exits 2 on error. Don't let set -e trip on a clean 1.
  hits="$(grep -rFn "$phrase" "${INCLUDES[@]}" "${EXCLUDES[@]}" "$REPO_ROOT" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "FAIL: banned phrase found: '$phrase'"
    echo "$hits" | sed 's/^/  /'
    echo
    exit_code=1
  fi
done

if [ "$exit_code" -ne 0 ]; then
  echo "---"
  echo "One or more banned phrases were found. These phrases falsely"
  echo "claim protocol-level safety for nLockTime=21 on non-mint"
  echo "transactions. See the HARD RULE 'nLockTime=21 is PROTOCOL for"
  echo "MINT, CONVENTION for everything else' in the workspace CLAUDE.md."
  echo
  echo "Rewrite the comment to describe what's actually true:"
  echo "  - MINT tx: 'protocol requires — this tx IS the mint'"
  echo "  - SDK-built transfer/settle: 'regression guard for the SDK"
  echo "    builder invariant; a third-party-wallet settle with"
  echo "    locktime=0 still delivers the cat via sat-tracking'"
  echo "  - cat21-wallet-signed tx: 'regression guard for cat21-wallet"
  echo "    HARD RULE #1'"
  exit 1
fi

echo "OK: no banned locktime-framing phrases found."
