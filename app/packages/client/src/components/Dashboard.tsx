import { Show } from "solid-js";
import { AppFooter } from "./AppFooter.tsx";
import { NavBar } from "./NavBar.tsx";
import { PortionsView } from "./PortionsView.tsx";
import { PortionsSkeleton } from "./PortionsSkeleton.tsx";
import { StatusPage } from "./StatusPage.tsx";
import type { SystemHealth } from "./helpers.ts";
import { page, shell } from "./styles.ts";
import type { FriendRow } from "./types.ts";
import type { Pending } from "./action-dialog-shared.ts";

export function Dashboard(
  props: {
    view: () => "portions" | "status";
    setView: (v: "portions" | "status") => void;
    onAdd: () => void;
    /** False when a blocked preflight check forbids new portions. */
    canAdd: () => boolean;
    addBlockReason: () => string | undefined;
    friends: { isPending: boolean; isError: boolean; error: unknown };
    rows: () => FriendRow[];
    totalQuota: () => number;
    totalUsed: () => number;
    overallPct: () => number;
    health: () => SystemHealth;
    onAction: (p: Pending) => void;
    onLogout?: () => void;
  },
) {
  return (
    <main class={page}>
      <div class={shell}>
        <NavBar
          view={props.view}
          setView={props.setView}
          onAdd={props.onAdd}
          canAdd={props.canAdd}
          addBlockReason={props.addBlockReason}
        />

        <Show
          when={!props.friends.isPending}
          fallback={<PortionsSkeleton />}
        >
          <Show
            when={!props.friends.isError}
            fallback={<p>Failed to load: {String(props.friends.error)}</p>}
          >
            <Show when={props.view() === "status"}>
              <StatusPage />
            </Show>
            <Show when={props.view() === "portions"}>
              <PortionsView
                rows={props.rows}
                totalQuota={props.totalQuota}
                totalUsed={props.totalUsed}
                overallPct={props.overallPct}
                onAdd={props.onAdd}
                onAction={props.onAction}
              />
            </Show>
          </Show>
        </Show>

        <AppFooter
          health={props.health}
          onStatus={() => props.setView("status")}
          onLogout={props.onLogout}
        />
      </div>
    </main>
  );
}
