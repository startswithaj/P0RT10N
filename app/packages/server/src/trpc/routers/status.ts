import { z } from "zod";
import { protectedProcedure, router } from "../trpc.ts";

/** System inventory + per-instance diagnostics for the ops/Status page. */
export const statusRouter = router({
  get: protectedProcedure.query(({ ctx }) => ctx.inventoryService.snapshot()),

  /** Latched boot-preflight result — the client banners + gates creation on it. */
  health: protectedProcedure.query(({ ctx }) =>
    ctx.systemHealthService.current()
  ),

  /** Re-run the preflight probe (e.g. after the admin enables HTTPS in the
   * Tailscale console) and return the fresh, re-latched result. */
  recheckHealth: protectedProcedure.mutation(({ ctx }) =>
    ctx.systemHealthService.probe()
  ),

  /** Deep diagnostics for one instance (state + health reason + recent logs). */
  diagnose: protectedProcedure
    .input(z.object({ instanceName: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.inventoryService.diagnose(input.instanceName)
    ),
});
