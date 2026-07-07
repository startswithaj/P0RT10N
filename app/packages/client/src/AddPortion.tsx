import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { ArrowLeft, Boxes, KeyRound, Mail, Server } from "lucide-solid";
import { addFriendInput } from "@p0rt1on/shared/domain";
import { Button } from "./components/ui/button.tsx";
import { IconButton } from "./components/ui/icon-button.tsx";
import { Input } from "./components/ui/input.tsx";
import * as Field from "./components/ui/field.tsx";
import * as NumberInput from "./components/ui/number-input.tsx";
import * as RadioGroup from "./components/ui/radio-group.tsx";

// "Add a portion" form. Collects a full AddFriendInput (+ enrollment choice) and
// hands it up; App runs the real friends.add mutation.

const GB = 1_000_000_000;

/** The form's output — an AddFriendInput plus the (frontend-only) enroll choice. */
export type NewPortion = {
  name: string;
  quotaBytes: number;
  retentionDays: number;
  isolationMode: "dedicated" | "shared";
  enroll: "key" | "invite";
};

const page = css({
  minH: "100dvh",
  bg: "bg.canvas",
  color: "fg.default",
  fontFamily: "body",
});
const shell = css({ maxW: "640px", mx: "auto", px: "6", py: "8" });
const topRow = css({
  display: "flex",
  alignItems: "center",
  gap: "3",
  mb: "2",
});
const title = css({ fontFamily: "display", fontSize: "xl", lineHeight: "1.2" });
const subtitle = css({ color: "fg.muted", fontSize: "sm", mb: "6", ml: "12" });

const card = css({
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l3",
  p: "6",
  display: "flex",
  flexDirection: "column",
  gap: "6",
  boxShadow: "lg",
});
const hint = css({ fontSize: "xs", color: "fg.muted" });

const chips = css({ display: "flex", gap: "2", flexWrap: "wrap" });

const modeGrid = css({
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "3",
});
// Each RadioGroup.Item rendered as a selectable card; `_checked` marks the
// currently-selected option (border + surface, no separate visible dot needed).
const modeCard = css({
  textAlign: "left",
  p: "4",
  rounded: "l2",
  borderWidth: "1px",
  borderColor: "border.default",
  bg: "bg.canvas",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: "1.5",
  _hover: { borderColor: "border.outline" },
  _checked: { borderColor: "brandcyan.9", bg: "bg.default" },
});
const modeHead = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  fontWeight: "bold",
  fontSize: "sm",
  color: "fg.default",
});
const modeIcon = css({ color: "brandcyan.9" });
// The radio indicator sits at the far right of the card header.
const radioDot = css({ ml: "auto", flexShrink: "0" });

const actions = css({
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "3",
  mt: "2",
});
// Why the CTA is disabled (CODE.md: no disabled buttons without a reason).
const blockHint = css({ fontSize: "sm", color: "fg.muted", mr: "auto" });
// Soft-isolation trade-off note, shown at the decision point (PLAN wireframe).
const sharedBanner = css({
  fontSize: "sm",
  color: "fg.default",
  bg: "bg.muted",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  p: "3",
  mt: "3",
});
// Primary CTA keeps the brand magenta spark (Park's solid is accent-cyan); the
// Button recipe still supplies sizing, radius and typography.
const sparkBtn = css({
  bg: "spark",
  borderColor: "spark",
  color: "white",
  _hover: { bg: "spark", opacity: "0.9" },
});

const PRESETS = [10, 30, 50, 100];
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
    label: "Invite to the tailnet",
    body:
      "Email them an invite to join with their own Tailscale identity and devices.",
  },
];
const MODES = [
  {
    id: "dedicated" as const,
    icon: Server,
    label: "Dedicated",
    body: "Its own MinIO instance — isolated bucket, key and quota.",
  },
  {
    id: "shared" as const,
    icon: Boxes,
    label: "Shared",
    body:
      "Shares one MinIO instance with other portions, still its own bucket, key and quota.",
  },
];

type FormIssue = { path: (string | number | symbol)[]; message: string };

function formIssues(core: unknown): FormIssue[] {
  const parsed = addFriendInput.safeParse(core);
  return parsed.success ? [] : parsed.error.issues;
}

function issueFor(issues: FormIssue[], field: string): string | null {
  return issues.find((i) => i.path[0] === field)?.message ?? null;
}

// CODE.md rule: a disabled button must say WHY. First blocking problem wins;
// the untouched-form case gets a friendlier prompt than a zod message.
function blockReasonFor(name: string, issues: FormIssue[]): string | null {
  if (name.trim() === "") return "Enter a friend name to continue";
  const first = issues[0];
  if (!first) return null;
  const labels: Record<string, string> = {
    name: "Name",
    quotaBytes: "Quota",
    retentionDays: "Retention",
  };
  return `${
    labels[String(first.path[0])] ?? String(first.path[0])
  }: ${first.message}`;
}

function QuotaField(
  props: {
    quota: () => number;
    setQuota: (n: number) => void;
    error: () => string | null;
  },
) {
  return (
    <Field.Root invalid={props.error() !== null}>
      <Field.Label>Storage quota (GB)</Field.Label>
      <div class={chips}>
        <For each={PRESETS}>
          {(gb) => (
            <Button
              type="button"
              size="sm"
              variant={props.quota() === gb ? "solid" : "outline"}
              onClick={() => props.setQuota(gb)}
            >
              {gb} GB
            </Button>
          )}
        </For>
      </div>
      <NumberInput.Root
        min={1}
        value={String(props.quota())}
        formatOptions={{ maximumFractionDigits: 0 }}
        onValueChange={(d) => props.setQuota(d.valueAsNumber)}
      >
        <NumberInput.Control>
          <NumberInput.Input />
          <NumberInput.IncrementTrigger />
          <NumberInput.DecrementTrigger />
        </NumberInput.Control>
      </NumberInput.Root>
      <Field.ErrorText>Must be a positive whole number of GB</Field.ErrorText>
    </Field.Root>
  );
}

function RetentionField(
  props: {
    retention: () => number;
    setRetention: (n: number) => void;
    error: () => string | null;
  },
) {
  return (
    <Field.Root invalid={props.error() !== null}>
      <Field.Label>Object-lock retention (days)</Field.Label>
      <NumberInput.Root
        min={1}
        value={String(props.retention())}
        formatOptions={{ maximumFractionDigits: 0 }}
        onValueChange={(d) => props.setRetention(d.valueAsNumber)}
      >
        <NumberInput.Control>
          <NumberInput.Input />
          <NumberInput.IncrementTrigger />
          <NumberInput.DecrementTrigger />
        </NumberInput.Control>
      </NumberInput.Root>
      <Field.HelperText>
        Backups are write-once for this long and bypass is denied — so even if a
        friend's machine is compromised, an attacker can't delete or encrypt
        their existing backups within the retention window.
      </Field.HelperText>
      <Field.ErrorText>
        Must be a positive whole number of days
      </Field.ErrorText>
    </Field.Root>
  );
}

function ModePicker(
  props: {
    mode: () => "dedicated" | "shared";
    setMode: (m: "dedicated" | "shared") => void;
  },
) {
  return (
    <RadioGroup.Root
      value={props.mode()}
      onValueChange={(d) => props.setMode(d.value as "dedicated" | "shared")}
    >
      <RadioGroup.Label>Isolation mode</RadioGroup.Label>
      <div class={modeGrid}>
        <For each={MODES}>
          {(m) => (
            <RadioGroup.Item value={m.id} class={modeCard}>
              <span class={modeHead}>
                <span class={modeIcon}>
                  <m.icon size={16} />
                </span>
                <RadioGroup.ItemText>{m.label}</RadioGroup.ItemText>
                <RadioGroup.ItemControl class={radioDot} />
              </span>
              <span class={hint}>{m.body}</span>
              <RadioGroup.ItemHiddenInput />
            </RadioGroup.Item>
          )}
        </For>
      </div>
      <Show when={props.mode() === "shared"}>
        <p class={sharedBanner}>
          Shared mode runs everyone's buckets in ONE MinIO process — isolation
          is IAM-policy level, not process level. A MinIO vulnerability or
          instance-root compromise exposes all portions on it. Choose Dedicated
          for stronger isolation.
        </p>
      </Show>
    </RadioGroup.Root>
  );
}

function EnrollPicker(
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

export function AddPortion(
  props: {
    onBack: () => void;
    onSubmit: (data: NewPortion) => void;
  },
) {
  const [name, setName] = createSignal("");
  const [mode, setMode] = createSignal<"dedicated" | "shared">("dedicated");
  const [quota, setQuota] = createSignal(30);
  const [retention, setRetention] = createSignal(14);
  const [enroll, setEnroll] = createSignal<"key" | "invite">("key");

  // The AddFriendInput fields this form assembles. Validation is delegated to
  // the same `addFriendInput` schema the server enforces (single source of
  // truth), so an empty/badly-formatted name or a non-positive-integer quota /
  // retention gates submit here exactly as it would be rejected at the API
  // boundary. (The NumberInputs already reject empty/negative/fractional input
  // at the widget level; this is the backstop and drives the disabled state.)
  const core = () => ({
    name: name().trim(),
    quotaBytes: Math.round(quota() * GB),
    retentionDays: retention(),
    isolationMode: mode(),
  });
  const issues = () => formIssues(core());
  const errFor = (field: string) => issueFor(issues(), field);
  const valid = () => issues().length === 0;
  const blockReason = () => blockReasonFor(name(), issues());

  return (
    <main class={page}>
      <div class={shell}>
        <div class={topRow}>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Back"
            onClick={props.onBack}
          >
            <ArrowLeft size={18} />
          </IconButton>
          <h1 class={title}>Add a portion</h1>
        </div>
        <p class={subtitle}>Provision a new friend's immutable S3 endpoint.</p>

        <form
          class={card}
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid()) return;
            props.onSubmit({ ...core(), enroll: enroll() });
          }}
        >
          <Field.Root invalid={name().trim() !== "" && errFor("name") !== null}>
            <Field.Label>Friend name</Field.Label>
            <Input
              placeholder="e.g. alice"
              autocomplete="off"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <Field.HelperText>
              Lowercase; used for their bucket and alias.
            </Field.HelperText>
            <Field.ErrorText>{errFor("name")}</Field.ErrorText>
          </Field.Root>

          <QuotaField
            quota={quota}
            setQuota={setQuota}
            error={() => errFor("quotaBytes")}
          />

          <ModePicker mode={mode} setMode={setMode} />

          <RetentionField
            retention={retention}
            setRetention={setRetention}
            error={() => errFor("retentionDays")}
          />

          <EnrollPicker enroll={enroll} setEnroll={setEnroll} />

          <div class={actions}>
            <Show when={blockReason()}>
              <span class={blockHint}>{blockReason()}</span>
            </Show>
            <Button type="button" variant="outline" onClick={props.onBack}>
              Cancel
            </Button>
            <Button type="submit" class={sparkBtn} disabled={!valid()}>
              Create portion
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
