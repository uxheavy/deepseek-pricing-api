import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { PricingDatabase, PricingScheduleWorker } from "../../alchemy.run.ts";

export const acceptanceStack = Alchemy.Stack(
  "PricingScheduleAcceptance",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    yield* PricingDatabase;
    const pricing = yield* PricingScheduleWorker;
    const control = yield* Cloudflare.Worker("PricingScheduleControl", {
      main: "./test/acceptance/control-worker.ts",
      env: { DB: PricingDatabase },
    });

    return {
      controlURL: control.url,
      pricingURL: pricing.url,
    };
  }),
);
