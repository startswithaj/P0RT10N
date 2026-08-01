import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";

/**
 * Services throw ServiceError, not TRPCError; the tRPC error middleware maps
 * `.code` onto a TRPCError so services never import anything tRPC-specific.
 */
export class ServiceError extends Error {
  readonly code: TRPC_ERROR_CODE_KEY;

  constructor(code: TRPC_ERROR_CODE_KEY, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string) {
    super("BAD_REQUEST", message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class NotImplementedError extends ServiceError {
  constructor(message: string) {
    super("NOT_IMPLEMENTED", message);
    this.name = "NotImplementedError";
  }
}

/**
 * The Tailscale token can't write the policy file, so a 403 throws this in auto mode;
 * manual mode skips the API call and surfaces these instructions instead.
 */
export class ManualAclRequiredError extends ServiceError {
  readonly instructions: string;
  constructor(instructions: string) {
    super("FORBIDDEN", "Tailscale ACL must be added manually");
    this.name = "ManualAclRequiredError";
    this.instructions = instructions;
  }
}
