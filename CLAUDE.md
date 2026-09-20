# CLAUDE.md

Repo-level guidance for `ordpool-space/ordpool` (a `mempool/mempool` fork). `backend/` and `frontend/` each carry a deeper `.claude/CLAUDE.md` with stack-specific conventions; this file holds the cross-cutting rules.

## HARD RULE: Keep useful comments
- Don't strip JSDoc or "why" inline comments under the banner of "simplification". Trim the text inside a comment (no bombast, no LLM-speak, no before/after history); keep the block.
- Applies to our code and to inherited upstream comments.
Why: JSDoc and "why" comments carry intent the type system can't; a `/simplify` pass once stripped 10 here and was reverted.
Ref: workspace `CLAUDE.md` "Keep useful comments (JSDoc AND inline 'why')"; rollback `6a880bfd3`.

## HARD RULE: Dependabot is BANNED
- Dependabot stays off in this repo. No exceptions. Do not restore it for "just security alerts" or "just version-update PRs".
- Current state: `.github/dependabot.yml` deleted; repo `vulnerability-alerts` + `automated-security-fixes` OFF via GitHub API.
- The 153 `git log main --author=dependabot` commits are mempool's history pulled in by upstream merges (`5ac7ae12e`, `464fc6c12`); leave them.
- On every `mempool/mempool` merge: if `.github/dependabot.yml` returns, `git rm` it in the merge commit; re-disable settings if the merge changed them:
  ```bash
  GH_TOKEN=<hans-crypto> gh api -X DELETE repos/ordpool-space/ordpool/vulnerability-alerts
  GH_TOKEN=<hans-crypto> gh api -X DELETE repos/ordpool-space/ordpool/automated-security-fixes
  ```
Why: unreviewed daily dep-bumps are a supply-chain door; a low-velocity Bitcoin codebase prefers "30 days behind" over a compromised package. Freshness comes from human review during the upstream-merge cycle.
<!-- long-rule: upstream-merge checklist + API commands -->

## CI workflows: which are REAL, which are inherited-dead

This repo is a `mempool/mempool` fork, so `.github/workflows/` carries both our CI and upstream's. Upstream's target infra we don't run (`runs-on: mempool-ci`, a self-hosted pool with 0 runners registered; and/or `push: master`, but our default branch is `main`). They queue until auto-cancelled yet appear "active" in the Actions tab.

**REAL CI (ubuntu-latest, main/stage_prod-triggered, trust these):** `test-backend`, `test-frontend`, `backend-integration` (MariaDB), `check-locktime-framing`, `test-count-floor-{backend,frontend}`, `e2e-regtest-mint` + `e2e-regtest-mint-cat21wallet` + `ordpool-e2e-nightly` (Playwright/regtest), `build-{backend,frontend}` (deploy to `*-build` repos), `dependabot-provenance-check`, `supply-chain-audit`.

**INHERITED-DEAD, DISABLED at the GitHub level, NOT deleted:** `ci.yml`, `docker.yml`, `e2e_parameterized.yml`, `get_backend_block_height.yml`, `get_backend_hash.yml`, `get_image_digest.yml`. Disable with `gh workflow disable <name>`; never `git rm` (upstream files conflict on merge). Re-check on every upstream merge (a merge can re-activate them).

**Do NOT stand up a `mempool-ci` self-hosted runner.** `ci.yml`'s jobs are backend/frontend build+lint+test (already green on ubuntu-latest via the REAL workflows) plus a Cypress matrix over `mempool`/`liquid`/`testnet4`, products v2 does not ship (mainnet-only). The only box is happysrv (runs the prod node); a runner there executes arbitrary workflow code = a supply-chain foothold on the node. Maintainer ruling: HQ `CLAUDE.md` "CI workflows", commit `773d197`.

**`supply-chain-audit.yml` is the EXCEPTION, never disable it.** It runs `backend/meta/scripts/check-install-scripts.sh` (fails if any package outside a whitelist has `hasInstallScript: true`) + `safe-install.sh`, the compensating control for the workspace `ignore-scripts=false` posture. Kept alive by the `master`->`main`, `mempool-ci`->`ubuntu-latest` fix.

**Audit method:** never trust HEAD check-runs (blind to path-filtered / dead workflows) or a bounded `gh run list --limit N`. Enumerate EVERY workflow and take ITS OWN latest run.

## HARD RULE: Linting is FORBIDDEN (mergeability with upstream)
- Never lint, auto-format, or wire lint into CI here. Permanent policy, not pending debt.
- Do NOT run `npm run lint:fix` / `eslint --fix` / `prettier --write` on any code here (upstream or ours).
- Do NOT hand-fix lint warnings to satisfy the linter. Do NOT wire `lint` into CI or into `build`/`test`/`start` (it's in none today).
- `lint` / `lint:fix` are neutered to `echo …; exit 1` (the mechanical backstop). Do NOT restore their eslint bodies, and do NOT delete them or `.eslintrc` (deleting upstream files conflicts on merge). On conflict, keep ours.
- New code: match surrounding style by hand (2-space indent, single quotes, trailing commas). By-eye, never an eslint gate.
- On every upstream merge: verify it didn't re-add a lint CI workflow or chain `build`/`test`/`start` into `lint`; undo if it did.
Why: upstream never linted (backend alone: ~1,376 ESLint problems, 239 errors, all inherited); auto-format rewrites thousands of upstream lines into permanent merge conflicts.
<!-- long-rule: forbidden-list + merge checklist -->

## HARD RULE: edge caching is Cloudflare's job, not mempool's nginx
- API edge caching is delegated to the Cloudflare edge. We do NOT run mempool's self-hosted nginx `proxy_cache` tier. Do not re-litigate or "simplify" this away.
- `backend/src/api/_ordpool/single-flight-cache.ts` (single-flight + SWR) covers the one thing Cloudflare's free plan can't: with no origin shield, concurrent edge-misses all reach origin. It is NOT redundant with the edge cache. Never delete it because "Cloudflare caches now".

| piece | file | nginx analogue |
|---|---|---|
| per-endpoint `Cache-Control` (`max-age`/`s-maxage`) | `backend/src/ordpool-cache-policy-middleware.ts` | `expires` |
| Cloudflare edge Cache Rule (respect-origin, allowlist) | `cloudflare/cache-rules.sh` + `cloudflare/rules/*.json` | `proxy_cache` |
| single-flight + SWR (origin herd-control) | `backend/src/api/_ordpool/single-flight-cache.ts` | `proxy_cache_use_stale updating` |
| API path-routing (`/api/v1/*`->backend, `/api/*`->electrs) | `backend/src/electrs-proxy-middleware.ts` | `location` blocks |

- TTL tiers (from mempool's observed prod values): immutable block-by-hash 30d, mining/statistics 120s, fees/tip 10-15s, dynamic (address/tx/ws/POST) uncached.
Why: Cloudflare gives cache + Pages + TLS/HTTP3 + DDoS free; our traffic is a few hundred req/s (mostly crawlers). nginx would re-implement that plus an ops burden for no benefit here.
Ref: workspace `cloudflare/CACHING.md` §0, read before changing anything about caching.
<!-- long-rule: caching decision table -->
