#!/usr/bin/env bash
#
# Supply-chain guard for frontend npm dependencies: audit the COMMITTED lockfile
# for install scripts outside the whitelist, then install EXACTLY that lockfile
# with `npm ci`.
#
# The committed package-lock.json is the reviewed source of truth, so this
# script never regenerates it. A `--package-lock-only` refresh here would let
# caret ranges drift to newer versions and turn a security check into an
# unreviewed dependency bump -- exactly what the workspace's lockfile-discipline
# posture forbids. A genuinely stale lockfile (out of sync with package.json) is
# caught by `npm ci`, which refuses to install a mismatched tree; the fix for
# that is a vetted lockfile update via the normal review flow, not a blind
# regeneration inside a security workflow.
#
# `npm ci` intentionally runs install scripts (ignore-scripts=false workspace
# wide) -- the check-install-scripts.sh whitelist is the control, so the audit
# runs first and gates the install.
#
# Usage (from repo root):
#   frontend/meta/scripts/safe-install.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "==> Auditing the committed lockfile for install scripts..."
bash "${SCRIPT_DIR}/check-install-scripts.sh"

echo ""
echo "==> Installing frontend from the committed lockfile (npm ci)..."
(cd "$FRONTEND_DIR" && npm ci)

echo ""
echo "Done."
