import { Match, Show, Switch } from "solid-js";
import { css } from "styled-system/css";
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

// A looping loader painted onto the button's border while the action runs: a
// conic-gradient arc, masked to a 2px ring, whose start angle (--p0-angle,
// registered in index.css) is animated by the `border-spin` keyframe so the
// highlight travels around the perimeter. The label stays put underneath.
const loadingBorder = css({
  position: "relative",
  _before: {
    content: '""',
    position: "absolute",
    inset: "0",
    borderRadius: "inherit",
    padding: "2px",
    background:
      "conic-gradient(from var(--p0-angle), transparent 0%, transparent 65%, currentColor 100%)",
    mask: "linear-gradient(black 0 0) content-box, linear-gradient(black 0 0)",
    maskComposite: "exclude",
    WebkitMaskComposite: "xor",
    animation: "border-spin 900ms linear infinite",
    pointerEvents: "none",
  },
});

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
          class={[
            props.p.kind === "offboard" ? "" : sparkBtn,
            props.busy() ? loadingBorder : "",
          ].join(" ")}
          disabled={!props.canConfirm()}
          onClick={props.onConfirm}
        >
          {confirmLabel(props.p.kind)}
        </Button>
      </div>
    </>
  );
}
