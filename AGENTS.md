# Pricing Schedule Service Map

## Scope
This repository owns the public anonymous pricing-schedule Worker. The parent decision record at `../../docs/decisions/0001-pricing-schedule-service.md` owns its service contract and failure policy.

## Canonical Commands
- `pnpm install` — install the pinned toolchain; `pnpm-workspace.yaml` explicitly approves only the `esbuild` and `workerd` build scripts required by local tooling.
- `pnpm run check` — type-check the Worker and validate `openapi/openapi.yaml`.
- `pnpm test` — run parser/hash tests and a local Alchemy workerd+D1 HTTP acceptance stack. It creates and tears down only local `.alchemy/` state.
- `pnpm run seed -- --stage production [--dry-run]` — write a verified snapshot to the **deployed** database. Run it after a deploy, because the cron refreshes only at `0 0 * * *` and nothing else can populate a fresh deployment. It runs the real refresh (fetch, validate, hash) locally and writes through the Cloudflare D1 API, so it does not add a write route to the service. `--dry-run` exercises the whole path without writing.
- `pnpm run dev` — local stack with local state. `pnpm exec alchemy deploy --stage production --yes` — deploy; `--yes` is required because the deploy refuses to prompt in a non-interactive terminal.

## Runtime Traps
These cost real time and are not visible from the code:

- **Do not use `redirect: "error"` in a Worker `fetch`.** workerd rejects it outright; use `"manual"` and check the status. Bun accepts it, so a local test passes while every deployed refresh fails.
- **A `ratelimit` binding's `namespaceId` must be a positive integer.** Alchemy accepts `number | string` and never validates it, so a name-like value deploys only after failing at the edge.
- **The pricing URL needs its trailing slash.** Without it the site answers 302 and the redirect refusal turns the daily refresh into a permanent failure.
- **`tools/seed.ts` reads the Cloudflare OAuth token from `~/.alchemy/profiles/<profile>/cloudflare.json`.** The token in `~/.alchemy/credentials/*/cloudflare-state-store.json` is the state store's own and the API rejects it.

## Ownership
- `src/worker.ts` exposes the runtime entrypoint; `src/http.ts` owns HTTP behavior and `src/storage.ts` owns the singleton snapshot transaction.
- `src/pricing-page.ts` owns the upstream contract check; it deliberately requires the known model table, an exact `OFF-PEAK`/`PEAK` tier, and the published peak-hours sentence, so an upstream reshaping fails loudly instead of silently changing what clients believe pricing is.
- `migrations/` owns the pinned, reviewed holiday manifest. Renew it before the manifest coverage ends; the API must not infer pricing beyond its coverage. `test/holiday-manifest.test.ts` asserts the migrations seed exactly the pinned fixture's holidays, because a hand-written list drifted once.
- `openapi/openapi.yaml` is the public response contract. Keep it aligned with `src/domain.ts` and `src/snapshot.ts`.
- `tools/seed.ts` is the operator path for populating a deployed database; it is not part of `alchemy deploy` and must stay that way.
- `test/acceptance/control-worker.ts` exists only to provision isolated local D1 state for acceptance tests. It is not part of the deploy stack.

## Deployment Boundary
The Worker is deployed to the `production` stage in the **UXheavy** Cloudflare
account and serves `https://deepseek-pricing-api.uxheavy.workers.dev`.

- The deployed address's source of truth is the stack's `url` output from
  `alchemy deploy --stage production`; the Worker's `name` in `alchemy.run.ts`
  determines it. The macOS app mirrors that URL in
  `Sources/DeepSeekBalance/PricingClient.swift`, so read the output rather than
  either file when they might disagree.
- Redeploy only with an explicit stage and the intended profile. A deploy
  without `--stage production` targets a different stage and cannot touch the
  production origin.
- The service serves its last verified snapshot and reports `STALE` metadata
  when a refresh fails. A deployment with no snapshot yet answers every read with
  503 and `Retry-After: 3600`; that is the contract, not a fault, and
  `pnpm run seed` is how a new deployment starts serving immediately.
