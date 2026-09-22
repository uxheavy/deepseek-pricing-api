import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

const stackState =
  process.env.ALCHEMY_DEV === "1" || process.env.ALCHEMY_TEST_DEV === "1"
    ? Alchemy.localState()
    : Cloudflare.state();

export const PricingDatabase = Cloudflare.D1.Database("PricingDatabase", {
  migrations: "./migrations",
});

const RequestLimiter = Cloudflare.RateLimit("RequestLimiter", {
  namespaceId: "pricing-schedule",
  simple: {
    limit: 5,
    period: 60,
  },
});

export const PricingScheduleWorker = Cloudflare.Worker("PricingScheduleWorker", {
  main: "./src/worker.ts",
  env: {
    DB: PricingDatabase,
    REQUEST_LIMIT: RequestLimiter,
  },
  crons: ["0 0 * * *"],
  workersDev: true,
});

export type WorkerEnv = Cloudflare.InferEnv<typeof PricingScheduleWorker>;

export default Alchemy.Stack(
  "DeepSeekPricingApi",
  {
    providers: Cloudflare.providers(),
    state: stackState,
  },
  Effect.gen(function* () {
    yield* PricingDatabase;
    const worker = yield* PricingScheduleWorker;

    return {
      url: worker.url,
    };
  }),
);
