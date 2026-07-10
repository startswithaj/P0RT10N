import { z } from "zod";
import { protectedProcedure, router } from "../trpc.ts";

/** System inventory + per-instance diagnostics for the ops/Status page. */
export const statusRouter = router({
  get: protectedProcedure.query(({ ctx }) => ctx.inventoryService.snapshot()),

  /** Deep diagnostics for one instance (state + health reason + recent logs). */
  diagnose: protectedProcedure
    .input(z.object({ instanceName: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.inventoryService.diagnose(input.instanceName)
    ),
});
