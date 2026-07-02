import { ServiceError } from "./ServiceError.ts";
import type { ProgressEvent } from "./progress.ts";

/**
 * Drive a progress generator to completion and return the value carried by its
 * terminal `done` event. Rejections from the generator propagate unchanged. This
 * is how the non-streaming addFriend/offboard paths reuse the streaming
 * generators without duplicating orchestration — Array.fromAsync drains without
 * a consumer loop (the repo's no-imperative-loops rule bans `for await`).
 */
export async function drainForResult<K, R>(
  gen: AsyncGenerator<ProgressEvent<K, R>>,
): Promise<R> {
  const events = await Array.fromAsync(gen);
  const done = events.find((e) => e.type === "done");
  if (!done || done.type !== "done") {
    throw new ServiceError(
      "INTERNAL_SERVER_ERROR",
      "progress stream ended without a done event",
    );
  }
  return done.result;
}
