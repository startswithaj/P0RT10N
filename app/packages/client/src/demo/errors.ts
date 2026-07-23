/** Thrown when a wire path has no demo handler — a coverage gap (should never
 *  fire: the handler maps are total-typed and the coverage test proves it). */
export class DemoUnhandledError extends Error {
  constructor(kind: "query" | "mutation" | "subscription", path: string) {
    super(`No demo handler for ${kind} "${path}"`);
    this.name = "DemoUnhandledError";
  }
}
