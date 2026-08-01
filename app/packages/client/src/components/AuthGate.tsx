import { type JSX, Show } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { Login } from "./Login.tsx";
import { toastError } from "./action-dialog-shared.ts";
import { queryClient, trpc } from "../trpc.ts";

export function createAuthGate() {
  const auth = createQuery(() => ({
    queryKey: ["auth"],
    queryFn: () => trpc.auth.status.query(),
    retry: false,
  }));
  const refetch = () => queryClient.invalidateQueries({ queryKey: ["auth"] });
  return {
    ready: () => auth.data !== undefined,
    enabled: () => auth.data?.enabled ?? false,
    // This is true only once auth has loaded and no password is configured; while
    // loading it stays false, so the insecure banner never flashes on first paint.
    noPassword: () => auth.data?.enabled === false,
    locked: () => {
      const d = auth.data;
      return d !== undefined && d.enabled && !d.authenticated;
    },
    refetch,
    logout: async () => {
      try {
        await trpc.auth.logout.mutate();
        refetch();
      } catch (e) {
        toastError(
          "Couldn't sign out",
          e instanceof Error ? e.message : String(e),
        );
      }
    },
  };
}

/** Renders nothing until the status query resolves, so the dashboard never flashes
 * before the auth state is known. */
export function AuthGate(
  props: { gate: ReturnType<typeof createAuthGate>; children: JSX.Element },
) {
  return (
    <Show when={props.gate.ready()}>
      <Show
        when={!props.gate.locked()}
        fallback={<Login onLoggedIn={props.gate.refetch} />}
      >
        {props.children}
      </Show>
    </Show>
  );
}
