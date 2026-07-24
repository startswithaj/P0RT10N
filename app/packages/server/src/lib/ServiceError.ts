import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";

/**
 * Transport-agnostic domain error. Services throw these; the tRPC
 * errorMiddleware maps `.code` straight onto a TRPCError so routers carry no
 * try/catch and services never import anything tRPC-specific.
 */
export class ServiceError extends Error {
  readonly code: TRPC_ERROR_CODE_KEY;

  constructor(code: TRPC_ERROR_CODE_KEY, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

/** Friend / instance not found. */
export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

/** Bad caller input that zod can't catch (e.g. name taken, offboard confirm mismatch). */
export class ValidationError extends ServiceError {
  constructor(message: string) {
    super("BAD_REQUEST", message);
    this.name = "ValidationError";
  }
}

/** Action illegal for the friend's current state (e.g. resize while provisioning). */
export class ConflictError extends ServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

/** A dependency that isn't wired yet (external impls land via integration). */
export class NotImplementedError extends ServiceError {
  constructor(message: string) {
    super("NOT_IMPLEMENTED", message);
    this.name = "NotImplementedError";
  }
}

/**
 * The Tailscale token can't edit the policy file (no `policy_file` write scope),
 * so the friend's ACL grant must be added by hand. Carries the exact lines to
 * paste. Thrown in `auto` ACL mode on a 403; in `manual` mode we skip the API
 * call and surface these instructions in the bundle instead.
 */
export class ManualAclRequiredError extends ServiceError {
  readonly instructions: string;
  constructor(instructions: string) {
    super("FORBIDDEN", "Tailscale ACL must be added manually");
    this.name = "ManualAclRequiredError";
    this.instructions = instructions;
  }
}
