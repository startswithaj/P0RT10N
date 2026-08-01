/** Thrown when a wire path has no demo handler; this is a coverage gap that
 *  should never fire, since the handler maps are total-typed and a coverage test proves it. */
export class DemoUnhandledError extends Error {
  constructor(kind: "query" | "mutation" | "subscription", path: string) {
    super(`No demo handler for ${kind} "${path}"`);
    this.name = "DemoUnhandledError";
  }
}
