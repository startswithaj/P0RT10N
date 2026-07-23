import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { KeyRound, Mail, TriangleAlert } from "lucide-solid";
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

// Amber warning shown when invite is chosen but no API token is configured.
const warnBox = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "2",
  fontSize: "sm",
  color: "warning",
  borderWidth: "1px",
  borderColor: "warning",
  rounded: "l2",
  p: "3",
  mt: "3",
});

const warnLink = css({
  color: "warning",
  textDecoration: "underline",
  _hover: { opacity: "0.85" },
});

// Tailscale admin console deep-links surfaced in the no-token warning.
const TS_USERS_URL = "https://login.tailscale.com/admin/users";
const TS_KEYS_URL = "https://login.tailscale.com/admin/settings/keys";

export function EnrollPicker(
  props: {
    enroll: () => "key" | "invite";
    setEnroll: (e: "key" | "invite") => void;
    email: () => string;
    setEmail: (v: string) => void;
    emailError: () => string | null;
    inviteApiConfigured: boolean;
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
        <Field.Root invalid={props.emailError() !== null}>
          <Field.Label>Email address</Field.Label>
          <Input
            type="email"
            placeholder="friend@example.com"
            autocomplete="off"
            value={props.email()}
            onInput={(e) => props.setEmail(e.currentTarget.value)}
          />
          <Field.ErrorText>{props.emailError()}</Field.ErrorText>
        </Field.Root>
        <Show when={!props.inviteApiConfigured}>
          <p class={warnBox}>
            <TriangleAlert size={16} />
            <span>
              P0RT1ON_TAILSCALE_API_TOKEN is not configured, so you'll need to
              invite your friend by hand in the{" "}
              <a
                class={warnLink}
                href={TS_USERS_URL}
                target="_blank"
                rel="noreferrer"
              >
                Tailscale console
              </a>. Tailscale OAuth can do everything except create invites. To
              automate this,{" "}
              <a
                class={warnLink}
                href={TS_KEYS_URL}
                target="_blank"
                rel="noreferrer"
              >
                generate a Tailscale API token
              </a>{" "}
              and set it as P0RT1ON_TAILSCALE_API_TOKEN.
            </span>
          </p>
        </Show>
      </Show>
    </RadioGroup.Root>
  );
}
