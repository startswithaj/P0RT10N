import { For, Show } from "solid-js";
import { KeyRound, Mail } from "lucide-solid";
import { Input } from "./ui/input.tsx";
import * as Field from "./ui/field.tsx";
import * as RadioGroup from "./ui/radio-group.tsx";
import {
  hint,
  modeCard,
  modeGrid,
  modeHead,
  modeIcon,
  radioDot,
} from "./styles.ts";

const ENROLL = [
  {
    id: "key" as const,
    icon: KeyRound,
    label: "Mint an auth key",
    body:
      "A pre-auth key they redeem with `tailscale up`. Headless — no account, joins as a tagged node.",
  },
  {
    id: "invite" as const,
    icon: Mail,
    label: "Invite to tailnet",
    body:
      "Email them an invite to join with their own Tailscale identity and devices.",
  },
];

export function EnrollPicker(
  props: {
    enroll: () => "key" | "invite";
    setEnroll: (e: "key" | "invite") => void;
  },
) {
  return (
    <RadioGroup.Root
      value={props.enroll()}
      onValueChange={(d) => props.setEnroll(d.value as "key" | "invite")}
    >
      <RadioGroup.Label>Tailscale enrollment</RadioGroup.Label>
      <div class={modeGrid}>
        <For each={ENROLL}>
          {(e) => (
            <RadioGroup.Item value={e.id} class={modeCard}>
              <span class={modeHead}>
                <span class={modeIcon}>
                  <e.icon size={16} />
                </span>
                <RadioGroup.ItemText>{e.label}</RadioGroup.ItemText>
                <RadioGroup.ItemControl class={radioDot} />
              </span>
              <span class={hint}>{e.body}</span>
              <RadioGroup.ItemHiddenInput />
            </RadioGroup.Item>
          )}
        </For>
      </div>
      <Show when={props.enroll() === "invite"}>
        <Field.Root>
          <Field.Label>Email address</Field.Label>
          <Input
            type="email"
            placeholder="friend@example.com"
            autocomplete="off"
          />
        </Field.Root>
      </Show>
    </RadioGroup.Root>
  );
}
