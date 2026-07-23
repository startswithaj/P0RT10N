import { Show } from "solid-js";
import { css } from "styled-system/css";
import { Check, XCircle } from "lucide-solid";
import { PROVISION_STEPS, type ProvisionStepKey } from "@p0rt1on/shared/steps";
import { Wordmark } from "./Wordmark.tsx";
import { Button } from "./ui/button.tsx";
import { StepChecklist, stepStatusFor } from "./StepChecklist.tsx";

// Provisioning view. friends.addStream streams a `step` event as each real step
// begins (and a `done`/error terminus), so the checklist reflects actual server
// progress — it advances only as far as the backend got and, on failure, marks
// the exact step that broke instead of a timer running past it.

/** The add stream's state, as far as this screen cares. `step` is the live step. */
export type ProvisionState =
  | { kind: "pending"; step: ProvisionStepKey | null }
  | { kind: "done" }
  | { kind: "error"; message: string; step: ProvisionStepKey | null };

/**
 * Step labels, swapping the auth-key wording for invite friends. With no API
 * token no invite is actually sent (it's recorded for the admin to send by
 * hand), so the label must not claim otherwise.
 */
function stepLabels(
  enroll: "key" | "invite",
  inviteApiConfigured: boolean,
): string[] {
  return PROVISION_STEPS.map((s) => {
    if (s.key !== "authkey" || enroll !== "invite") return s.label;
    return inviteApiConfigured
      ? "Sending Tailscale invite"
      : "Preparing manual invite";
  });
}

/** Index of the live step (0 before the first event); length when fully done. */
function activeIndexFor(state: ProvisionState): number {
  if (state.kind === "done") return PROVISION_STEPS.length;
  if (state.step === null) return 0;
  return PROVISION_STEPS.findIndex((s) => s.key === state.step);
}

const page = css({
  minH: "100dvh",
  bg: "bg.canvas",
  color: "fg.default",
  fontFamily: "body",
});
const shell = css({ maxW: "640px", mx: "auto", px: "6", py: "8" });
const head = css({ display: "flex", alignItems: "center", gap: "3", mb: "1" });
const title = css({ fontFamily: "display", fontSize: "xl", lineHeight: "1.2" });
const subtitle = css({ color: "fg.muted", fontSize: "sm", mb: "6" });
const card = css({
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l3",
  p: "3",
  boxShadow: "lg",
});
const success = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: "2",
  mt: "8",
});
const successMark = css({ color: "cyan.9" });
const errorMark = css({ color: "fg.error" });
const errorText = css({
  color: "fg.error",
  fontSize: "sm",
  maxW: "sm",
  wordBreak: "break-word",
});
const successTitle = css({ fontFamily: "display", fontSize: "lg" });
const successSub = css({ color: "fg.muted", fontSize: "sm", maxW: "sm" });
const actions = css({
  display: "flex",
  justifyContent: "center",
  gap: "3",
  mt: "6",
});
// Primary CTA keeps the brand magenta spark + rounded-full pill + hover lift;
// the Button recipe supplies sizing, gap and typography. _hover pins bg:spark so
// the recipe's cyan solid hover fill can't show.
const sparkBtn = css({
  rounded: "full",
  bg: "spark",
  color: "white",
  transition: "transform 0.12s ease",
  _hover: { bg: "spark", transform: "translateY(-1px)" },
});
// Secondary action: Park's outline variant, kept as a rounded-full pill to match.
const pillOutline = css({ rounded: "full" });

export function Provisioning(
  props: {
    name: string;
    enroll: "key" | "invite";
    /** Whether email invites are wired; drives the invite step's honest label. */
    inviteApiConfigured?: boolean;
    state: () => ProvisionState;
    onDone: () => void;
    onViewBundle: () => void;
  },
) {
  const steps = stepLabels(props.enroll, props.inviteApiConfigured ?? true);
  const complete = () => props.state().kind === "done";
  const failed = () => props.state().kind === "error";
  const status = () => stepStatusFor(activeIndexFor(props.state()), failed());

  return (
    <main class={page}>
      <div class={shell}>
        <div class={head}>
          <Wordmark size={20} />
        </div>
        <h1 class={title}>
          <Show when={!complete()} fallback={`${props.name} is ready`}>
            <Show when={!failed()} fallback={`Couldn't set up ${props.name}`}>
              Setting up {props.name}
            </Show>
          </Show>
        </h1>
        <p class={subtitle}>
          <Show
            when={!complete()}
            fallback="Their immutable S3 endpoint is live over Tailscale."
          >
            <Show
              when={!failed()}
              fallback="Provisioning failed — nothing was handed over."
            >
              Provisioning their immutable S3 endpoint — hang tight.
            </Show>
          </Show>
        </p>

        <div class={card}>
          <StepChecklist steps={steps} status={status()} />
        </div>

        <Show when={complete()}>
          <div class={success}>
            <Check size={28} class={successMark} />
            <div class={successTitle}>All done</div>
            <p class={successSub}>
              The credentials bundle (S3 key, endpoint
              {props.enroll === "invite"
                ? " and invite"
                : " and Tailscale key"}) is ready to hand over — shown once.
            </p>
          </div>
          <div class={actions}>
            <Button
              variant="outline"
              class={pillOutline}
              onClick={props.onDone}
            >
              Back to portions
            </Button>
            <Button class={sparkBtn} onClick={props.onViewBundle}>
              View bundle
            </Button>
          </div>
        </Show>

        <Show when={failed()}>
          <div class={success}>
            <XCircle size={28} class={errorMark} />
            <div class={successTitle}>Provisioning failed</div>
            <p class={errorText}>
              {(() => {
                const s = props.state();
                return s.kind === "error" ? s.message : "Unknown error.";
              })()}
            </p>
          </div>
          <div class={actions}>
            <Button
              variant="outline"
              class={pillOutline}
              onClick={props.onDone}
            >
              Back to portions
            </Button>
          </div>
        </Show>
      </div>
    </main>
  );
}
