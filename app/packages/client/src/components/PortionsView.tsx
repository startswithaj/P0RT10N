import { For, Show } from "solid-js";
import { Activity, Boxes, HardDrive, Plus } from "lucide-solid";
import { Button } from "./ui/button.tsx";
import { StatCard } from "./StatCard.tsx";
import { PortionCard } from "./PortionCard.tsx";
import { gb } from "./helpers.ts";
import {
  cardGrid,
  emptyState,
  emptyTitle,
  sectionTitle,
  statGrid,
} from "./styles.ts";
import type { FriendRow } from "./types.ts";
import type { Pending } from "./action-dialog-shared.ts";

export function PortionsView(
  props: {
    rows: () => FriendRow[];
    totalQuota: () => number;
    totalUsed: () => number;
    overallPct: () => number;
    onAdd: () => void;
    onAction: (p: Pending) => void;
  },
) {
  return (
    <>
      <div class={statGrid}>
        <StatCard
          icon={() => <Boxes size={16} />}
          label="Portions"
          value={String(props.rows().length)}
        />
        <StatCard
          icon={() => <HardDrive size={16} />}
          label="Allocated"
          value={gb(props.totalQuota())}
        />
        <StatCard
          icon={() => <Activity size={16} />}
          label="Used"
          value={gb(props.totalUsed())}
          sub={`${props.overallPct()}%`}
        />
      </div>

      <h2 class={sectionTitle}>Portions</h2>
      <Show
        when={props.rows().length > 0}
        fallback={
          <div class={emptyState}>
            <Boxes size={28} />
            <p class={emptyTitle}>No portions yet</p>
            <p>
              Lend a friend a slice of your disk — create your first portion.
            </p>
            <Button size="sm" onClick={() => props.onAdd()}>
              <Plus size={16} /> Add portion
            </Button>
          </div>
        }
      >
        <div class={cardGrid}>
          <For each={props.rows()}>
            {(f) => <PortionCard friend={f} onAction={props.onAction} />}
          </For>
        </div>
      </Show>
    </>
  );
}
