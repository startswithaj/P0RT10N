import { ServiceError } from "./ServiceError.ts";
import type { ProgressEvent } from "./progress.ts";

/**
 * Drains the generator to completion and returns the terminal `done` event's value;
 * rejections propagate unchanged. Array.fromAsync avoids a `for await` loop, which this repo bans.
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
