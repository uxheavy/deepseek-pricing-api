# Pricing Schedule Service Map

## Scope
This repository owns the public anonymous pricing-schedule Worker. The parent decision record at `../../docs/decisions/0001-pricing-schedule-service.md` owns its service contract and failure policy.

## Canonical Commands
- `pnpm install` — install the pinned toolchain; `pnpm-workspace.yaml` explicitly approves only the `esbuild` and `workerd` build scripts required by local tooling.
- `pnpm run check` — type-check the Worker and validate `openapi/openapi.yaml`.
- `pnpm test` — run parser/hash tests and a local Alchemy workerd+D1 HTTP acceptance stack. It creates and tears down only local `.alchemy/` state.

## Ownership
- `src/worker.ts` exposes the runtime entrypoint; `src/http.ts` owns HTTP behavior and `src/storage.ts` owns the singleton snapshot transaction.
- `migrations/` owns the pinned, reviewed holiday manifest. Renew it before the manifest coverage ends; the API must not infer pricing beyond its coverage.
- `openapi/openapi.yaml` is the public response contract. Keep it aligned with `src/domain.ts` and `src/snapshot.ts`.
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
  when a refresh fails. Until the first scheduled run writes a snapshot, every
  read is a 503 with `Retry-After: 3600`; that is the contract, not a fault.
