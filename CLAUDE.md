# CLAUDE.md

Repo-level guidance for `ordpool-space/ordpool`. The two halves of the repo
(`backend/` and `frontend/`) each have their own deeper `.claude/CLAUDE.md`
with stack-specific conventions; this file documents cross-cutting rules
that apply to the whole repo.

## HARD RULE: Dependabot is BANNED

**Dependabot stays off in this repo. No exceptions.**

Why: auto-bumping dependencies on a daily/weekly cadence is an open door for
supply-chain attacks. Each Dependabot PR that lands without human-eyes
review brings whatever upstream maintainers (and any of their compromised
contributors) shipped during the cooldown window. For a low-velocity,
security-sensitive Bitcoin codebase the cost of "patches behind by 30 days"
is vastly lower than the cost of "we shipped a compromised package because
a bot decided to".

History: disabled on 2026-04-28 after Dependabot opened 7 PRs in one wave
(`mysql2`, `axios`, `@types/node`, `@scure/btc-signer`, `echarts`,
`zone.js`, `@noble/secp256k1`) and queued ~50 CI runs against them. Every
Dependabot PR ever opened on this repo was closed unmerged. The 153
Dependabot commits visible in `git log main --author=dependabot` are
mempool's own history brought in wholesale by the upstream merges
(`5ac7ae12e`, `464fc6c12`) — not ours; leave them in place to keep the
upstream merge history clean.

What's been done (this commit + sibling API calls):
- `.github/dependabot.yml` deleted (was commit `23d173561`).
- Repo-level `vulnerability-alerts` and `automated-security-fixes` toggled
  OFF via the GitHub API.

**Every future upstream merge from `mempool/mempool` MUST:**
1. Check whether mempool re-shipped `.github/dependabot.yml`. If yes,
   `git rm` it in the merge commit. Do **not** let it land.
2. Re-disable the repo settings if the merge changed them:
   ```bash
   GH_TOKEN=<hans-crypto> gh api -X DELETE repos/ordpool-space/ordpool/vulnerability-alerts
   GH_TOKEN=<hans-crypto> gh api -X DELETE repos/ordpool-space/ordpool/automated-security-fixes
   ```
3. Do **not** restore Dependabot for "just security alerts" or "just
   version-update PRs". The whole tool is banned, not just one feature.

Dependency freshness in this codebase is maintained by human review during
the planned upstream-mempool merge cycle. That's already the cadence we
ship at and is the only safe surface for taking new package versions.
