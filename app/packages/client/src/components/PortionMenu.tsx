import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  KeyRound,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  Radio,
  Trash2,
} from "lucide-solid";
import * as Menu from "./ui/menu.tsx";
import { dangerItem, iconBtn, menuItem } from "./styles.ts";
import type { FriendRow } from "./types.ts";
import type { ActionKind, Pending } from "./action-dialog-shared.ts";

// ---- actions ---- the burger menu opens a proper Park UI dialog (below).

export function PortionMenu(
  props: { friend: FriendRow; onAction: (p: Pending) => void },
) {
  return (
    <Menu.Root
      onSelect={(d) =>
        props.onAction({
          friend: props.friend,
          kind: d.value as ActionKind,
        })}
    >
      <Menu.Trigger class={iconBtn} aria-label="Actions">
        <MoreVertical size={18} />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            <Menu.Item value="resize" class={menuItem}>
              <Pencil size={15} /> Resize quota
            </Menu.Item>
            <Menu.Item value="rotate-s3" class={menuItem}>
              <KeyRound size={15} /> Rotate S3 key
            </Menu.Item>
            <Menu.Item value="rotate-ts" class={menuItem}>
              <Radio size={15} /> Re-issue Tailscale key
            </Menu.Item>
            <Menu.Separator />
            {
              /* State guards mirror the server: suspend only from active,
                resume only from suspended; neither for provisioning/failed. */
            }
            <Show when={props.friend.status === "active"}>
              <Menu.Item value="suspend" class={menuItem}>
                <PauseCircle size={15} /> Suspend
              </Menu.Item>
            </Show>
            <Show when={props.friend.status === "suspended"}>
              <Menu.Item value="resume" class={menuItem}>
                <PlayCircle size={15} /> Resume
              </Menu.Item>
            </Show>
            <Menu.Item value="offboard" class={`${menuItem} ${dangerItem}`}>
              <Trash2 size={15} /> Offboard
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
