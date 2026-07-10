import { type JSX, Show } from "solid-js";
import * as Card from "./ui/card.tsx";
import { cardReset, statBody, statSub, statTop, statValue } from "./styles.ts";

export function StatCard(
  props: {
    icon: () => JSX.Element;
    label: string;
    value: string;
    sub?: string;
  },
) {
  return (
    <Card.Root class={cardReset}>
      <Card.Body class={statBody}>
        <div class={statTop}>
          {props.icon()}
          {props.label}
        </div>
        <div class={statValue}>
          {props.value}
          <Show when={props.sub}>
            <span class={statSub}>· {props.sub}</span>
          </Show>
        </div>
      </Card.Body>
    </Card.Root>
  );
}
