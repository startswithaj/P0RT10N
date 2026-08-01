import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { css } from "styled-system/css";
import { ArrowLeft, Boxes, Server } from "lucide-solid";
import { addFriendInput, type Enrollment } from "@p0rt1on/shared/domain";
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

const GB = 1_000_000_000;
const NAME_ERROR_DEBOUNCE_MS = 500;

export type NewPortion = {
  name: string;
  quotaBytes: number;
  retentionDays: number;
  isolationMode: "dedicated" | "shared";
  enroll: "key" | "invite";
  enrollment: Enrollment;
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

const blockHint = css({ fontSize: "sm", color: "fg.muted", mr: "auto" });

const sharedBanner = css({
  fontSize: "sm",
  color: "fg.default",
  bg: { base: "gray.2", _dark: "bg.canvas" },
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  p: "3",
  mt: "3",
});

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

function blockReasonFor(name: string, issues: FormIssue[]): string | null {
  if (name.trim() === "") return "Enter a friend name to continue";
  const first = issues[0];
  if (!first) return null;
  const labels: Record<string, string> = {
    name: "Name",
    quotaBytes: "Quota",
    retentionDays: "Retention",
    enrollment: "Email",
  };
  return `${
    labels[String(first.path[0])] ?? String(first.path[0])
  }: ${first.message}`;
}

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

function createNameField() {
  const [name, setName] = createSignal("");
  const settle = createSettled(NAME_ERROR_DEBOUNCE_MS);
  onCleanup(settle.dispose);

  const onInput = (value: string) => {
    setName(value);
    settle.touch();
  };

  return {
    name,
    onInput,
    settleNow: settle.settleNow,
    settled: settle.settled,
  };
}

function createEnrollField() {
  const [enroll, setEnroll] = createSignal<"key" | "invite">("key");
  const [email, setEmail] = createSignal("");

  const enrollment = (): Enrollment =>
    enroll() === "invite"
      ? { mode: "invite", email: email().trim() }
      : { mode: "authKey" };

  return { enroll, setEnroll, email, setEmail, enrollment };
}

function submitGate(
  props: { gated?: () => boolean; gateReason?: () => string | undefined },
  issues: () => FormIssue[],
  name: () => string,
  nameTaken: () => boolean,
) {
  const gated = () => props.gated?.() ?? false;

  const reason = () => {
    if (gated()) return props.gateReason?.();
    if (nameTaken()) {
      return `Name: a portion named "${name().trim()}" already exists`;
    }
    return blockReasonFor(name(), issues());
  };

  return {
    canSubmit: () => issues().length === 0 && !nameTaken() && !gated(),
    blockReason: reason,
  };
}

/** Names are lowercase-enforced by friendNameSchema, so an exact match here
 * mirrors the friends.name UNIQUE constraint the server enforces. */
function isNameTaken(name: string, taken?: () => string[]): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && (taken?.() ?? []).includes(trimmed);
}

function nameFieldError(
  settled: boolean,
  taken: boolean,
  formErr: () => string | null,
): string | null {
  if (!settled) return null;
  if (taken) return "A portion with this name already exists";
  return formErr();
}

function FormHeader(props: { onBack: () => void }) {
  return (
    <>
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
    </>
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
    /** Undefined means the invite-capability check is still loading; it is
     * treated as configured since the warning is only a hint, never a submit gate. */
    inviteApiConfigured?: boolean;
    /** A blocked preflight check is a hard gate on submitting, not just an advisory hint. */
    gated?: () => boolean;
    gateReason?: () => string | undefined;
    /** Existing portion names; a clash is caught here instead of tripping the
     * friends.name UNIQUE constraint on the server mid-provisioning. */
    takenNames?: () => string[];
  },
) {
  const nameField = createNameField();
  const name = nameField.name;
  // Native autofocus doesn't fire for an element added on a view change rather
  // than a page load, so focus is set imperatively once the form mounts.
  const [nameEl, setNameEl] = createSignal<HTMLInputElement>();
  onMount(() => nameEl()?.focus());
  const [mode, setMode] = createSignal<"dedicated" | "shared">("dedicated");
  const [quota, setQuota] = createSignal(30);
  const [retention, setRetention] = createSignal(14);
  const { enroll, setEnroll, email, setEmail, enrollment } =
    createEnrollField();

  // Validation reuses the same addFriendInput schema the server enforces, so
  // submit is gated here exactly as the API would reject the request.
  const core = () => ({
    name: name().trim(),
    quotaBytes: Math.round(quota() * GB),
    retentionDays: retention(),
    isolationMode: mode(),
    enrollment: enrollment(),
  });

  const issues = () => formIssues(core());
  const errFor = (field: string) => issueFor(issues(), field);
  const nameTaken = () => isNameTaken(name(), props.takenNames);
  const { canSubmit, blockReason } = submitGate(props, issues, name, nameTaken);

  const nameError = () =>
    nameFieldError(nameField.settled(), nameTaken(), () => errFor("name"));

  return (
    <main class={page}>
      <div class={shell}>
        <FormHeader onBack={props.onBack} />

        <form
          class={card}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit()) return;
            props.onSubmit({ ...core(), enroll: enroll() });
          }}
        >
          <Field.Root invalid={name().trim() !== "" && nameError() !== null}>
            <Field.Label>Friend name</Field.Label>
            <Input
              ref={(el) => setNameEl(el)}
              placeholder="e.g. alice"
              autocomplete="off"
              value={name()}
              onInput={(e) => nameField.onInput(e.currentTarget.value)}
              onBlur={nameField.settleNow}
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

          <EnrollPicker
            enroll={enroll}
            setEnroll={setEnroll}
            email={email}
            setEmail={setEmail}
            emailError={() => (email().trim() !== ""
              ? errFor("enrollment")
              : null)}
            inviteApiConfigured={props.inviteApiConfigured ?? true}
          />

          <div class={actions}>
            <Show when={blockReason()}>
              <span class={blockHint}>{blockReason()}</span>
            </Show>
            <Button type="button" variant="outline" onClick={props.onBack}>
              Cancel
            </Button>
            <Button type="submit" class={sparkBtn} disabled={!canSubmit()}>
              Create portion
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
