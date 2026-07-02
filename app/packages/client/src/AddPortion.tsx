import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { ArrowLeft, Boxes, KeyRound, Mail, Server } from "lucide-solid";

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
const backBtn = css({
  display: "grid",
  placeItems: "center",
  w: "9",
  h: "9",
  rounded: "l2",
  flexShrink: "0",
  color: "fg.muted",
  cursor: "pointer",
  borderWidth: "1px",
  borderColor: "border.default",
  _hover: { bg: "bg.muted", color: "fg.default" },
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
const field = css({ display: "flex", flexDirection: "column", gap: "2" });
const label = css({ fontSize: "sm", fontWeight: "bold", color: "fg.default" });
const hint = css({ fontSize: "xs", color: "fg.muted" });
const inputWrap = css({
  position: "relative",
  display: "flex",
  alignItems: "center",
});
const input = css({
  w: "full",
  h: "11",
  px: "3.5",
  rounded: "l2",
  bg: "bg.canvas",
  borderWidth: "1px",
  borderColor: "border.default",
  color: "fg.default",
  fontFamily: "body",
  fontSize: "sm",
  // Hide the browser's number spinners so they don't overlap the GB/days suffix.
  appearance: "textfield",
  MozAppearance: "textfield",
  "&::-webkit-inner-spin-button": { WebkitAppearance: "none", margin: "0" },
  "&::-webkit-outer-spin-button": { WebkitAppearance: "none", margin: "0" },
  _placeholder: { color: "fg.muted" },
  _focus: {
    borderColor: "brandcyan.9",
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineColor: "brandcyan.9",
  },
});
const suffix = css({
  position: "absolute",
  right: "3.5",
  color: "fg.muted",
  fontSize: "sm",
  pointerEvents: "none",
});

const chips = css({ display: "flex", gap: "2", flexWrap: "wrap" });
const chipBase = css({
  px: "3.5",
  h: "9",
  rounded: "full",
  borderWidth: "1px",
  borderColor: "border.default",
  bg: "bg.canvas",
  color: "fg.muted",
  fontSize: "sm",
  fontFamily: "body",
  cursor: "pointer",
  _hover: { color: "fg.default" },
});
const chipSel = css({
  borderColor: "brandcyan.9",
  color: "brandcyan.11",
  bg: "bg.default",
});

const modeGrid = css({
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "3",
});
const modeBase = css({
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
});
const modeSel = css({ borderColor: "brandcyan.9", bg: "bg.default" });
const modeHead = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  fontWeight: "bold",
  fontSize: "sm",
  color: "fg.default",
});
const modeIcon = css({ color: "brandcyan.9" });

const actions = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: "3",
  mt: "2",
});
const ghostBtn = css({
  display: "inline-flex",
  alignItems: "center",
  px: "5",
  h: "11",
  rounded: "full",
  fontFamily: "body",
  fontWeight: "bold",
  fontSize: "sm",
  color: "fg.muted",
  bg: "transparent",
  borderWidth: "1px",
  borderColor: "border.default",
  cursor: "pointer",
  _hover: { color: "fg.default", borderColor: "border.outline" },
});
const sparkBtn = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "2",
  px: "6",
  h: "11",
  rounded: "full",
  fontFamily: "body",
  fontWeight: "bold",
  fontSize: "sm",
  bg: "spark",
  color: "white",
  borderWidth: "1.5px",
  borderColor: "spark",
  cursor: "pointer",
  transition: "transform 0.12s ease",
  _hover: { transform: "translateY(-1px)" },
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

function QuotaField(
  props: { quota: () => number; setQuota: (n: number) => void },
) {
  return (
    <div class={field}>
      <label class={label}>Storage quota</label>
      <div class={chips}>
        <For each={PRESETS}>
          {(gb) => (
            <button
              type="button"
              class={`${chipBase} ${props.quota() === gb ? chipSel : ""}`}
              onClick={() => props.setQuota(gb)}
            >
              {gb} GB
            </button>
          )}
        </For>
      </div>
      <div class={inputWrap}>
        <input
          class={input}
          type="number"
          value={props.quota()}
          onInput={(e) => props.setQuota(Number(e.currentTarget.value))}
        />
        <span class={suffix}>GB</span>
      </div>
    </div>
  );
}

function ModePicker(
  props: {
    mode: () => "dedicated" | "shared";
    setMode: (m: "dedicated" | "shared") => void;
  },
) {
  return (
    <div class={field}>
      <label class={label}>Isolation mode</label>
      <div class={modeGrid}>
        <For each={MODES}>
          {(m) => (
            <button
              type="button"
              class={`${modeBase} ${props.mode() === m.id ? modeSel : ""}`}
              onClick={() => props.setMode(m.id)}
            >
              <span class={modeHead}>
                <span class={modeIcon}>
                  <m.icon size={16} />
                </span>
                {m.label}
              </span>
              <span class={hint}>{m.body}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function EnrollPicker(
  props: {
    enroll: () => "key" | "invite";
    setEnroll: (e: "key" | "invite") => void;
  },
) {
  return (
    <div class={field}>
      <label class={label}>Tailscale enrollment</label>
      <div class={modeGrid}>
        <For each={ENROLL}>
          {(e) => (
            <button
              type="button"
              class={`${modeBase} ${props.enroll() === e.id ? modeSel : ""}`}
              onClick={() => props.setEnroll(e.id)}
            >
              <span class={modeHead}>
                <span class={modeIcon}>
                  <e.icon size={16} />
                </span>
                {e.label}
              </span>
              <span class={hint}>{e.body}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={props.enroll() === "invite"}>
        <div class={inputWrap}>
          <input
            class={input}
            type="email"
            placeholder="friend@example.com"
            autocomplete="off"
          />
        </div>
      </Show>
    </div>
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

  return (
    <main class={page}>
      <div class={shell}>
        <div class={topRow}>
          <button
            type="button"
            class={backBtn}
            aria-label="Back"
            onClick={props.onBack}
          >
            <ArrowLeft size={18} />
          </button>
          <h1 class={title}>Add a portion</h1>
        </div>
        <p class={subtitle}>Provision a new friend's immutable S3 endpoint.</p>

        <form
          class={card}
          onSubmit={(e) => {
            e.preventDefault();
            if (!name().trim()) return;
            props.onSubmit({
              name: name().trim(),
              quotaBytes: Math.round(quota() * GB),
              retentionDays: retention(),
              isolationMode: mode(),
              enroll: enroll(),
            });
          }}
        >
          <div class={field}>
            <label class={label} for="name">Friend name</label>
            <div class={inputWrap}>
              <input
                id="name"
                class={input}
                placeholder="e.g. alice"
                autocomplete="off"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </div>
            <span class={hint}>
              Lowercase; used for their bucket and alias.
            </span>
          </div>

          <QuotaField quota={quota} setQuota={setQuota} />

          <ModePicker mode={mode} setMode={setMode} />

          <div class={field}>
            <label class={label} for="lock">Object-lock retention</label>
            <div class={inputWrap}>
              <input
                id="lock"
                class={input}
                type="number"
                min="1"
                value={retention()}
                onInput={(e) => setRetention(Number(e.currentTarget.value))}
              />
              <span class={suffix}>days</span>
            </div>
            <span class={hint}>
              Backups are write-once for this long and bypass is denied — so
              even if a friend's machine is compromised, an attacker can't
              delete or encrypt their existing backups within the retention
              window.
            </span>
          </div>

          <EnrollPicker enroll={enroll} setEnroll={setEnroll} />

          <div class={actions}>
            <button type="button" class={ghostBtn} onClick={props.onBack}>
              Cancel
            </button>
            <button type="submit" class={sparkBtn}>Create portion</button>
          </div>
        </form>
      </div>
    </main>
  );
}
