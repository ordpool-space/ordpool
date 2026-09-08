# CLAUDE.md

Repo-level guidance for `ordpool-space/ordpool`. The two halves of the repo
(`backend/` and `frontend/`) each have their own deeper `.claude/CLAUDE.md`
with stack-specific conventions; this file documents cross-cutting rules
that apply to the whole repo.

## HARD RULE: Keep useful comments

**Don't strip JSDoc or "why" inline comments under the banner of
"simplification".** The text inside a comment can be trimmed (no
bombast, no LLM-speak, no before-after history); the block itself
stays. The 2026-05-20 alkanes `/simplify` pass (commit `1d8d82a15`)
stripped 10 useful comments in this repo and had to be rolled back
in commit `6a880bfd3` on 2026-05-21. Full decision tree in the
workspace `CLAUDE.md` HARD RULE "Keep useful comments (JSDoc AND
inline 'why')".

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

## CI workflows: which are REAL, which are inherited-dead

This repo is a `mempool/mempool` fork, so `.github/workflows/` carries both
our own CI and upstream's. The upstream ones target infrastructure we don't
run (`runs-on: mempool-ci` — a self-hosted runner pool with **0 runners
registered** — and/or `push: master`, but our default branch is `main`).
They therefore CANNOT run: they queue until auto-cancelled, yet appear
"active" in the Actions tab and read as safety nets they are not.

**REAL CI (ubuntu-latest, main/stage_prod-triggered — trust these):**
`test-backend`, `test-frontend`, `backend-integration` (MariaDB),
`check-locktime-framing`, `test-count-floor-{backend,frontend}`,
`e2e-regtest-mint` + `e2e-regtest-mint-cat21wallet` + `ordpool-e2e-nightly`
(Playwright/regtest), `build-{backend,frontend}` (deploy → `*-build` repos),
`dependabot-provenance-check`, and **`supply-chain-audit`** (see below).

**INHERITED-DEAD — DISABLED at the GitHub level, NOT deleted:** `ci.yml`,
`docker.yml`, `e2e_parameterized.yml`, `get_backend_block_height.yml`,
`get_backend_hash.yml`, `get_image_digest.yml`. Disable with
`gh workflow disable <name>`; do NOT `git rm` them (upstream files — deleting
conflicts on every future mempool merge, per the never-delete-upstream
convention). Disabling drops them from the "active" list so audits stop
counting them as live nets, while the files stay mergeable. Re-check on every
upstream merge (a merge can re-activate them).

**Do NOT chase `mempool-ci` / stand up a self-hosted runner.** Maintainer's
ruling (HQ `CLAUDE.md` "CI workflows", commit `773d197`): `ci.yml`'s jobs are
backend/frontend build+lint+test (already green on ubuntu-latest via the REAL
workflows above) plus a Cypress matrix over `mempool`/`liquid`/`testnet4` —
Liquid and testnet4 are products v2 does not ship (mainnet-only). So `ci.yml`
is redundant-or-irrelevant, not a missing net. A runner is the wrong trade:
the only box is happysrv, which runs the prod node; a GH Actions runner there
executes arbitrary workflow code = a supply-chain foothold on the node.

**`supply-chain-audit.yml` is the EXCEPTION — revived, never disable it.** It
runs `backend/meta/scripts/check-install-scripts.sh` (fails the build if any
package outside a whitelist has `hasInstallScript: true`) + `safe-install.sh`.
That is the compensating control the workspace `.npmrc` posture depends on
(`ignore-scripts=false` workspace-wide, "lockfile discipline" as the named
Shai-Hulud mitigation). It was silently dead since the `master`→`main` rename;
revived with the two-line fix `master`→`main`, `mempool-ci`→`ubuntu-latest`.

**Lint is NOT enforced in CI.** `npm run lint` runs only in the now-disabled
`ci.yml`; the backend alone reports 1376 problems (239 errors) of inherited
mempool-fork debt, so wiring ESLint into required CI needs a baseline-or-fix
pass on that debt first — a real, disclosed follow-up, not a hidden gap.

**Audit method (how to check green honestly):** never trust HEAD check-runs
(blind to path-filtered / dead workflows) or a bounded `gh run list --limit N`
(blind to anything last run outside the window). Enumerate EVERY workflow and
take ITS OWN latest run.

## HARD RULE: edge caching is Cloudflare's job — we do NOT run mempool's nginx

**DECISION (do not re-litigate, do not "simplify" away): API edge caching is
delegated to the Cloudflare edge. We deliberately do NOT run mempool's
self-hosted nginx `proxy_cache` tier.** mempool front their explorer with a
multi-region nginx fleet and *refuse* Cloudflare — because they want full
independence and operate at a scale that justifies it. **Neither applies to
us:** we don't care about Cloudflare-independence, and our traffic is a few
hundred req/s (mostly crawlers). Cloudflare gives us the cache tier + Pages +
TLS/HTTP3 + DDoS absorption for **free, with zero infra to run or patch**.
Standing up nginx would re-implement what Cloudflare already gives us, plus an
ops burden, for no benefit here.

**The one nginx feature Cloudflare's FREE plan cannot provide**, and how we
cover it — memorise this, it is the trap:

> nginx's `proxy_cache_use_stale updating` does concurrent-miss **coalescing**
> + edge **stale-while-revalidate**. Cloudflare's free plan has **no origin
> shield**: concurrent edge-misses (per PoP, per TTL rollover) ALL reach the
> origin. So the edge cache does NOT make the origin stampede-proof by itself.
> **`backend/src/api/_ordpool/single-flight-cache.ts` (single-flight + SWR) is
> the in-process stand-in for that one nginx feature. It is NOT redundant with
> the Cloudflare edge cache. Never delete it because "Cloudflare caches now."**

The three pieces that make up our caching, and where each lives:

| piece | file | role (nginx analogue) |
|---|---|---|
| per-endpoint `Cache-Control` (`max-age`/`s-maxage`) | `backend/src/ordpool-cache-policy-middleware.ts` | nginx `expires` |
| Cloudflare edge Cache Rule (respect-origin, allowlist) | `cloudflare/cache-rules.sh` + `cloudflare/rules/*.json` | nginx `proxy_cache` |
| single-flight + SWR (origin herd-control) | `backend/src/api/_ordpool/single-flight-cache.ts` | nginx `proxy_cache_use_stale updating` |
| API path-routing (`/api/v1/*`→backend, `/api/*`→electrs) | `backend/src/electrs-proxy-middleware.ts` | nginx `location` blocks |

TTL tiers are adopted from mempool's own observed prod values / nginx tiers:
immutable block-by-hash 30d, mining/statistics 120s, fees/tip 10-15s, dynamic
(address/tx/ws/POST) uncached. Full role-by-role comparison + the measurements
behind this decision live in the workspace `cloudflare/CACHING-STUDY.md` §0.
**Read it before changing anything about caching.**
