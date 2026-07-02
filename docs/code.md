# p0rt1on — Codebase Reference

## Overview

**p0rt1on** is a self-hosted, multi-tenant **immutable S3 service over
Tailscale** — a web UI to provision and manage per-friend MinIO buckets (size,
Object-Lock immutability, per-user access key, VPN route) for offsite backups.
It is backup-tool-agnostic; how a friend backs up into their bucket is their
choice (Kopia recommended). See [`../PLAN.md`](../PLAN.md) for the architecture.

## Tech Stack

| Layer        | Technology                                                           |
| ------------ | -------------------------------------------------------------------- |
| Runtime      | Deno (TypeScript)                                                    |
| Networking   | Stock `tailscaled` per friend (userspace), `tailscale serve` → MinIO |
| Storage      | MinIO (S3) — versioning + Object Lock + per-bucket hard quota        |
| Admin        | `mc` (MinIO client) shelled out for bucket/user/policy/quota ops     |
| Metadata     | Deno KV or SQLite (holds **no secrets**)                             |
| Server tests | Deno built-in test runner, `@std/expect`, `@std/testing`             |

> Stack beyond the runtime is still being finalized — treat this table as the
> committed core (Deno + stock `tailscaled` + MinIO) and `PLAN.md` as the source
> of truth.

## Code Style — functional by default

The custom lint plugins enforce a functional, immutable style. Write to it from
the start:

- **No `let`** — use `const` with early returns, ternaries, or `reduce`.
- **No imperative loops** (`for`, `for...of`, `for...in`, `while`) — use
  `.map()` / `.filter()` / `.reduce()`.
- **No mutation** — don't mutate function parameters, outer-scope collections in
  `.forEach()`, or shared objects. Return new values instead.
- **Keep expressions simple** — no nested ternaries; no multi-line ternaries or
  boolean expressions past a few lines. Extract a named helper instead.
- **Keep functions short** — production functions ≤110 lines; break larger ones
  up.
- **Never swallow a catch** — log, rethrow, or assign the error; an empty
  `catch` is banned.

## Key Patterns

- **Dependency injection** — services are classes with constructor-injected
  dependencies, wired once at the composition root (entry point). New services
  are instantiated there and passed where needed; avoid global singletons.
- **Thin routers / handlers** — validate input (Zod), call a service, return the
  result. Business logic lives in services, not in route handlers.
- **Facade + sub-services** — when a service grows multiple concerns, split it
  into a facade that delegates to focused sub-services.
- **Shared types and schemas live in one place** — put shared types in a single
  `types.ts` and Zod schemas in `schemas.ts` so server and client agree.
- **Prefer a query builder over raw SQL** — if using a SQL DB (e.g. Drizzle),
  use typed column references and operators (`eq`, `gte`, `inArray`, …). Reserve
  raw `sql` templates for things the builder can't express.
- **Shell-outs are wrapped** — external CLIs (`mc`, `tailscale`/`tailscaled`)
  are accessed through a thin typed wrapper module (`mc.ts`, `runtime.ts`),
  never invoked ad hoc from handlers.

## Testing

Code changes should have test coverage. Server tests use Deno's built-in runner
(`@std/testing/bdd`, `@std/expect`).

- **`throwingMock<T>(label, overrides)`** — a Proxy-based stub where unstubbed
  method calls throw `"{label}.{method} was called but not stubbed"` instead of
  failing with `undefined is not a function`. Only stub the methods a test
  exercises; everything else fails loudly. No `as unknown as T` double-casts.
- **`testable()`** — access private methods in tests without `as any` casts.
- **`FakeTime`** (`@std/testing/time`) for time-dependent tests.
- **Factory-with-overrides** for fixtures — `buildX({ field: override })`
  helpers in a shared `test-factories.ts`, so tests state only what they care
  about.
- **Integration tests** use real class instances with an in-memory database
  (e.g. `:memory:`) to exercise full workflows across services.
- **Databases in tests** — use `:memory:` or a uniquely-named temp file; never
  the real data path. Clean up any files created.
- **No test globals** — don't leak shared mutable state across tests via
  module-level `let`/globals (enforced by the `no-test-globals` lint rule).

(The `throwingMock` / `testable` helpers are conventions to establish under a
`test-helpers/` directory as the server code lands — port them from the same
pattern when first needed.)

## Quality Commands

Run before finishing any task:

```
deno task check:all   — fmt + fmt:check + lint + type-check + tests
```

Other commands:

```
deno task test        — Run all tests
deno task lint        — Lint all code (includes the custom plugins)
deno task fmt         — Auto-fix formatting
deno task fmt:check   — Check formatting
deno task check       — Type-check
```

## Lint

Lint config lives in `deno.json` (`lint.plugins`, `lint.rules`). The custom
project-style rules — `expression-complexity`, `function-length`,
`no-foreach-mutation`, `no-imperative-loops`, `no-let`, `no-param-mutation`,
`no-swallowed-catch`, `no-test-globals`, `test-file-length` — are documented in
[`../devtools/lint-plugins/README.md`](../devtools/lint-plugins/README.md).

The Deno built-in `no-non-null-assertion` rule is opted in on top of the
`recommended` tag. To narrow `T | null | undefined` in tests, use
`assertExists(x)` from `@std/assert` instead of `x!`.
