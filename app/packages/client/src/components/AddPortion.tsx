import { createSignal, For, onCleanup, Show } from "solid-js";
import { css } from "styled-system/css";
import { ArrowLeft, Boxes, Server } from "lucide-solid";
import { addFriendInput } from "@p0rt1on/shared/domain";
import { Button } from "./ui/button.tsx";
import { IconButton } from "./ui/icon-button.tsx";
import { Input } from "./ui/input.tsx";
import * as Field from "./ui/field.tsx";
import * as NumberInput from "./ui/number-input.tsx";
import * as RadioGroup from "./ui/radio-group.tsx";
import { QuotaField } from "./QuotaField.tsx";
import { EnrollPicker } from "./EnrollPicker.tsx";
import {
  hint,
  modeCard,
  modeGrid,
  modeHead,
  modeIcon,
  radioDot,
} from "./styles.ts";

// "Add a portion" form. Collects a full AddFriendInput (+ enrollment choice) and
// hands it up; App runs the real friends.add mutation.

const GB = 1_000_000_000;
/** Pause before an invalid name shows its error (don't flash mid-word). */
const NAME_ERROR_DEBOUNCE_MS = 500;

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
  // Same recessed gray as the unselected mode cards above it — one gray, not two.
  bg: { base: "gray.2", _dark: "bg.canvas" },
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

/**
 * Debounced "settled" flag: false while the user is actively typing, true
 * after a pause of `delayMs` (or immediately via settleNow, e.g. on blur).
 */
function createSettled(delayMs: number) {
  const [settled, setSettled] = createSignal(true);
  const box = { timer: 0 };
  const touch = () => {
    setSettled(false);
    clearTimeout(box.timer);
    box.timer = setTimeout(() => setSettled(true), delayMs);
  };
  const settleNow = () => {
    clearTimeout(box.timer);
    setSettled(true);
  };
  return { settled, touch, settleNow, dispose: () => clearTimeout(box.timer) };
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
        {/* v1 markup: Input is a sibling of Control (see QuotaField). */}
        <NumberInput.Input />
        <NumberInput.Control>
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

  // The name error is debounced: "al…" is invalid until the third letter, so
  // flagging on every keystroke flashes an error at someone mid-word. Submit
  // gating stays immediate — only the error's visibility waits for a typing
  // pause (or blur, which settles instantly).
  const nameSettle = createSettled(NAME_ERROR_DEBOUNCE_MS);
  onCleanup(nameSettle.dispose);
  const onNameInput = (value: string) => {
    setName(value);
    nameSettle.touch();
  };
  const nameError = () => (nameSettle.settled() ? errFor("name") : null);

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
          <Field.Root invalid={name().trim() !== "" && nameError() !== null}>
            <Field.Label>Friend name</Field.Label>
            <Input
              placeholder="e.g. alice"
              autocomplete="off"
              value={name()}
              onInput={(e) => onNameInput(e.currentTarget.value)}
              onBlur={nameSettle.settleNow}
            />
            <Field.HelperText>
              Lowercase; used for their bucket and alias.
            </Field.HelperText>
            <Field.ErrorText>{nameError()}</Field.ErrorText>
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
