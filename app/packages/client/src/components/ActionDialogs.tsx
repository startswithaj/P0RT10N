import { Match, Show, Switch } from "solid-js";
import { ResizeDialog } from "./ResizeDialog.tsx";
import { RotateS3Dialog } from "./RotateS3Dialog.tsx";
import { RotateTsDialog } from "./RotateTsDialog.tsx";
import { SuspendDialog } from "./SuspendDialog.tsx";
import { ResumeDialog } from "./ResumeDialog.tsx";
import { ResendInviteDialog } from "./ResendInviteDialog.tsx";
import { OffboardDialog } from "./OffboardDialog.tsx";
import type { AddBundle, Pending } from "./action-dialog-shared.ts";

/**
 * Routes the pending burger-menu action to its own focused dialog. Each dialog
 * is mounted only while its action is active, so its state resets naturally on
 * every open — there's no shared state machine.
 */
export function ActionDialogs(props: {
  pending: Pending | null;
  onClose: () => void;
  onBundle: (b: AddBundle) => void;
}) {
  return (
    <Show when={props.pending}>
      {(p) => (
        <Switch>
          <Match when={p().kind === "resize"}>
            <ResizeDialog friend={p().friend} onClose={props.onClose} />
          </Match>
          <Match when={p().kind === "rotate-s3"}>
            <RotateS3Dialog
              friend={p().friend}
              onClose={props.onClose}
              onBundle={props.onBundle}
            />
          </Match>
          <Match when={p().kind === "rotate-ts"}>
            <RotateTsDialog friend={p().friend} onClose={props.onClose} />
          </Match>
          <Match when={p().kind === "suspend"}>
            <SuspendDialog friend={p().friend} onClose={props.onClose} />
          </Match>
          <Match when={p().kind === "resume"}>
            <ResumeDialog friend={p().friend} onClose={props.onClose} />
          </Match>
          <Match when={p().kind === "resend-invite"}>
            <ResendInviteDialog friend={p().friend} onClose={props.onClose} />
          </Match>
          <Match when={p().kind === "offboard"}>
            <OffboardDialog friend={p().friend} onClose={props.onClose} />
          </Match>
        </Switch>
      )}
    </Show>
  );
}
