import { type JSX, Show } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { Login } from "./Login.tsx";
import { toastError } from "./action-dialog-shared.ts";
import { queryClient, trpc } from "../trpc.ts";

/** Auth gate: session state + the login/logout transitions the App renders on. */
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

/** Renders the login screen when locked, the app once authenticated (or auth
 * off). Nothing until the status query resolves, to avoid a dashboard flash. */
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
