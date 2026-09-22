import type { WorkerEnv } from "../alchemy.run.ts";
import { handleRequest } from "./http.ts";
import { refreshSchedule } from "./refresh.ts";

export default {
  fetch(request, env) {
    return handleRequest({ request, env });
  },

  scheduled(controller, env, context) {
    context.waitUntil(
      refreshSchedule({
        database: env.DB,
        observedAt: new Date(controller.scheduledTime),
      }),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
