import { createSignal, Show } from "solid-js";
import { css } from "styled-system/css";
import { Check, Copy, Eye, EyeOff, Mail, ShieldAlert } from "lucide-solid";
import { Wordmark } from "./components/brand.tsx";
import { Button } from "./components/ui/button.tsx";
import { IconButton } from "./components/ui/icon-button.tsx";
import { trpc } from "./trpc.ts";

// The "shown once" credentials hand-off, rendered from the real FriendBundle
// that friends.add returned (s3 key/secret, endpoint, Tailscale up command,
// Kopia quickstart). The secret + auth key are not retrievable again.

type FriendBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;

const page = css({
  minH: "100dvh",
  bg: "bg.canvas",
  color: "fg.default",
  fontFamily: "body",
});
const shell = css({ maxW: "640px", mx: "auto", px: "6", py: "8" });
const head = css({ mb: "1" });
const title = css({ fontFamily: "display", fontSize: "xl", lineHeight: "1.2" });
const subtitle = css({ color: "fg.muted", fontSize: "sm", mb: "6" });

const warn = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "3",
  p: "4",
  rounded: "l2",
  borderWidth: "1px",
  borderColor: "spark",
  bg: "bg.default",
  boxShadow: "lg",
  mb: "6",
});
const warnIcon = css({ color: "spark", flexShrink: "0", mt: "0.5" });
const warnText = css({ fontSize: "sm", lineHeight: "1.5" });

const section = css({ mb: "6" });
const eyebrow = css({
  fontSize: "xs",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "fg.muted",
  mb: "2",
});
const credCard = css({
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  px: "4",
  boxShadow: "lg",
});
const fieldRow = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "3",
  py: "3",
  borderBottomWidth: "1px",
  borderColor: "border.default",
  _last: { borderBottomWidth: "0" },
});
const fieldMeta = css({ minW: "0" });
const fieldLabel = css({
  fontSize: "xs",
  color: "fg.muted",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  mb: "1",
});
const fieldValue = css({
  fontFamily: "body",
  fontSize: "sm",
  color: "fg.default",
  wordBreak: "break-all",
});
const valueRow = css({ display: "flex", alignItems: "center", gap: "2" });
const copiedIcon = css({ color: "brandcyan.9" });

const codeWrap = css({ position: "relative" });
const codeBlock = css({
  fontFamily: "body",
  fontSize: "xs",
  lineHeight: "1.9",
  color: "fg.default",
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  p: "4",
  pr: "12",
  overflowX: "auto",
  whiteSpace: "pre",
  boxShadow: "lg",
});
const codeCopy = css({ position: "absolute", top: "2.5", right: "2.5" });

const inviteNote = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  fontSize: "sm",
  color: "fg.muted",
});
const inviteIcon = css({ color: "brandcyan.9" });
const aclNote = css({ fontSize: "sm", color: "fg.default", mb: "2" });
const aclEyebrow = css({
  fontSize: "xs",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "spark",
  mb: "2",
});

const actions = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: "3",
  mt: "8",
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

const DOTS = "••••••••••••••••••••••••";

function CopyButton(
  props: {
    id: string;
    value: string;
    copied: () => string | null;
    onCopy: (id: string, v: string) => void;
  },
) {
  return (
    <IconButton
      variant="outline"
      size="sm"
      class={props.copied() === props.id ? copiedIcon : undefined}
      aria-label="Copy"
      onClick={() => props.onCopy(props.id, props.value)}
    >
      <Show when={props.copied() === props.id} fallback={<Copy size={15} />}>
        <Check size={15} />
      </Show>
    </IconButton>
  );
}

function CredentialsCard(
  props: {
    accessKey: string;
    secret: string;
    endpoint: string;
    bucket: string;
    revealed: () => boolean;
    setRevealed: (fn: (r: boolean) => boolean) => void;
    copied: () => string | null;
    onCopy: (id: string, v: string) => void;
  },
) {
  return (
    <div class={section}>
      <div class={eyebrow}>S3 credentials</div>
      <div class={credCard}>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Access key</div>
            <div class={fieldValue}>{props.accessKey}</div>
          </div>
          <CopyButton
            id="ak"
            value={props.accessKey}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </div>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Secret key</div>
            <div class={fieldValue}>
              {props.revealed() ? props.secret : DOTS}
            </div>
          </div>
          <div class={valueRow}>
            <IconButton
              variant="outline"
              size="sm"
              aria-label="Reveal"
              onClick={() => props.setRevealed((r) => !r)}
            >
              <Show when={props.revealed()} fallback={<Eye size={15} />}>
                <EyeOff size={15} />
              </Show>
            </IconButton>
            <CopyButton
              id="sk"
              value={props.secret}
              copied={props.copied}
              onCopy={props.onCopy}
            />
          </div>
        </div>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Endpoint</div>
            <div class={fieldValue}>{props.endpoint}</div>
          </div>
          <CopyButton
            id="ep"
            value={props.endpoint}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </div>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Bucket</div>
            <div class={fieldValue}>{props.bucket}</div>
          </div>
          <CopyButton
            id="bk"
            value={props.bucket}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </div>
      </div>
    </div>
  );
}

function TailscaleSection(
  props: {
    enroll: "key" | "invite";
    authCmd: string;
    copied: () => string | null;
    onCopy: (id: string, v: string) => void;
  },
) {
  return (
    <div class={section}>
      <div class={eyebrow}>Tailscale</div>
      <Show
        when={props.enroll === "key"}
        fallback={
          <span class={inviteNote}>
            <span class={inviteIcon}>
              <Mail size={16} />
            </span>
            An invite has been emailed — they join with their own identity.
          </span>
        }
      >
        <div class={codeWrap}>
          <pre class={codeBlock}>{props.authCmd}</pre>
          <span class={codeCopy}>
            <CopyButton
              id="ts"
              value={props.authCmd}
              copied={props.copied}
              onCopy={props.onCopy}
            />
          </span>
        </div>
      </Show>
    </div>
  );
}

function QuickstartSection(
  props: {
    snippet: string;
    copied: () => string | null;
    onCopy: (id: string, v: string) => void;
  },
) {
  return (
    <div class={section}>
      <div class={eyebrow}>Quickstart (Kopia)</div>
      <div class={codeWrap}>
        <pre class={codeBlock}>{props.snippet}</pre>
        <span class={codeCopy}>
          <CopyButton
            id="snip"
            value={props.snippet}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </span>
      </div>
    </div>
  );
}

export function Bundle(
  props: {
    bundle: FriendBundle;
    enroll: "key" | "invite";
    onDone: () => void;
  },
) {
  const [copied, setCopied] = createSignal<string | null>(null);
  const [revealed, setRevealed] = createSignal(false);

  const onCopy = (id: string, value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    }).catch(() => {});
  };

  const authCmd = () => props.bundle.tailscaleUpCommand ?? "";
  const copyAll = () =>
    onCopy(
      "all",
      `Access key: ${props.bundle.s3AccessKeyId}\n` +
        `Secret: ${props.bundle.s3SecretKey}\n` +
        `Endpoint: ${props.bundle.s3Endpoint}\n` +
        `Bucket: ${props.bundle.bucket}`,
    );

  return (
    <main class={page}>
      <div class={shell}>
        <div class={head}>
          <Wordmark size={20} />
        </div>
        <h1 class={title}>Credentials for {props.bundle.name}</h1>
        <p class={subtitle}>Hand these to {props.bundle.name} — securely.</p>

        <div class={warn}>
          <span class={warnIcon}>
            <ShieldAlert size={18} />
          </span>
          <span class={warnText}>
            The secret key is shown <strong>once</strong>{" "}
            and can't be retrieved again. Copy it now — if it's lost, rotate the
            key to issue a new one.
          </span>
        </div>

        <CredentialsCard
          accessKey={props.bundle.s3AccessKeyId}
          secret={props.bundle.s3SecretKey}
          endpoint={props.bundle.s3Endpoint}
          bucket={props.bundle.bucket}
          revealed={revealed}
          setRevealed={setRevealed}
          copied={copied}
          onCopy={onCopy}
        />

        <Show when={authCmd() || props.enroll === "invite"}>
          <TailscaleSection
            enroll={props.enroll}
            authCmd={authCmd()}
            copied={copied}
            onCopy={onCopy}
          />
        </Show>

        <Show when={props.bundle.manualAclInstructions}>
          {(instr) => (
            <div class={section}>
              <div class={aclEyebrow}>Action needed — Tailscale ACL</div>
              <p class={aclNote}>
                Your Tailscale token can't edit the policy automatically. Paste
                these lines into your policy or {props.bundle.name}{" "}
                can't reach their endpoint.
              </p>
              <div class={codeWrap}>
                <pre class={codeBlock}>{instr()}</pre>
                <span class={codeCopy}>
                  <CopyButton
                    id="acl"
                    value={instr()}
                    copied={copied}
                    onCopy={onCopy}
                  />
                </span>
              </div>
            </div>
          )}
        </Show>

        <QuickstartSection
          snippet={props.bundle.kopiaQuickstart}
          copied={copied}
          onCopy={onCopy}
        />

        <div class={actions}>
          <Button variant="outline" class={pillOutline} onClick={props.onDone}>
            Done
          </Button>
          <Button class={sparkBtn} onClick={copyAll}>
            <Show when={copied() === "all"} fallback={<Copy size={16} />}>
              <Check size={16} />
            </Show>
            Copy all
          </Button>
        </div>
      </div>
    </main>
  );
}
