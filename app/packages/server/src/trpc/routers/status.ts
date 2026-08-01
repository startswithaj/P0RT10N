import { z } from "zod";
import { protectedProcedure, router } from "../trpc.ts";

export const statusRouter = router({
  get: protectedProcedure.query(({ ctx }) => ctx.inventoryService.snapshot()),

  health: protectedProcedure.query(({ ctx }) =>
    ctx.systemHealthService.current()
  ),

  recheckHealth: protectedProcedure.mutation(({ ctx }) =>
    ctx.systemHealthService.probe()
  ),

  diagnose: protectedProcedure
    .input(z.object({ instanceName: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.inventoryService.diagnose(input.instanceName)
    ),
});
