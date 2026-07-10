import { Match, Show, Switch } from "solid-js";
import * as Field from "./ui/field.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import {
  actionDesc,
  actionsRow,
  confirmLabel,
  desc,
  errText,
  type Pending,
  sparkBtn,
} from "./action-dialog-shared.ts";

// The confirm view: description, an optional input (quota for resize, name for
// offboard) and the confirm/cancel buttons.
export function ConfirmBody(props: {
  p: Pending;
  qty: () => number;
  setQty: (n: number) => void;
  confirmName: () => string;
  setConfirmName: (s: string) => void;
  err: () => string | null;
  busy: () => boolean;
  canConfirm: () => boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <p class={desc}>{actionDesc(props.p)}</p>
      <Switch>
        <Match when={props.p.kind === "resize"}>
          <Field.Root>
            <Field.Label>Quota (GB)</Field.Label>
            <Input
              type="number"
              min="1"
              value={props.qty()}
              onInput={(e) => props.setQty(Number(e.currentTarget.value))}
            />
          </Field.Root>
        </Match>
        <Match when={props.p.kind === "offboard"}>
          <Field.Root>
            <Field.Label>Type "{props.p.friend.name}" to confirm</Field.Label>
            <Input
              autocomplete="off"
              value={props.confirmName()}
              onInput={(e) => props.setConfirmName(e.currentTarget.value)}
            />
          </Field.Root>
        </Match>
      </Switch>
      <Show when={props.err()}>
        <p class={errText}>{props.err()}</p>
      </Show>
      <div class={actionsRow}>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          colorPalette={props.p.kind === "offboard" ? "red" : undefined}
          class={props.p.kind === "offboard" ? undefined : sparkBtn}
          loading={props.busy()}
          disabled={!props.canConfirm()}
          onClick={props.onConfirm}
        >
          {confirmLabel(props.p.kind)}
        </Button>
      </div>
    </>
  );
}
