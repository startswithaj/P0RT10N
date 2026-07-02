import { z } from "zod";
import { publicProcedure, router } from "../trpc.ts";

/** System inventory + per-instance diagnostics for the ops/Status page. */
export const statusRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.inventoryService.snapshot()),

  /** Deep diagnostics for one instance (state + health reason + recent logs). */
  diagnose: publicProcedure
    .input(z.object({ instanceName: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.inventoryService.diagnose(input.instanceName)
    ),
});
