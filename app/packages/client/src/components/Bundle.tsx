import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { Check, Copy, ShieldAlert } from "lucide-solid";
import { Wordmark } from "./Wordmark.tsx";
import { Button } from "./ui/button.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { CredentialsCard } from "./CredentialsCard.tsx";
import { InviteBundleSection } from "./InviteBundleSection.tsx";
import {
  aclEyebrow,
  codeBlock,
  codeBlockWrapped,
  codeCopy,
  codeWrap,
  eyebrow,
  section,
} from "./bundle-styles.ts";
import { toastError } from "./action-dialog-shared.ts";
import { trpc } from "../trpc.ts";

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

const aclNote = css({ fontSize: "sm", color: "fg.default", mb: "2" });

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

/** Non-fatal degradations from the server (e.g. rotate couldn't remove the
 * old credential) — must be visible, not buried in server logs. */
function ServerWarnings(props: { warnings?: string[] }) {
  return (
    <Show when={props.warnings?.length}>
      <For each={props.warnings}>
        {(warning) => (
          <div class={warn}>
            <span class={warnIcon}>
              <ShieldAlert size={18} />
            </span>
            <span class={warnText}>{warning}</span>
          </div>
        )}
      </For>
    </Show>
  );
}

function TailscaleSection(
  props: {
    bundle: FriendBundle;
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
          <InviteBundleSection
            bundle={props.bundle}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        }
      >
        <div class={codeWrap}>
          <pre class={codeBlockWrapped}>{props.authCmd}</pre>
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

/**
 * "Copy all" means ALL of it: every section rendered on the bundle screen, in
 * the same order — S3 credentials, Tailscale enrollment, manual ACL lines
 * (when shown), and the Kopia quickstart.
 */
/** The Tailscale lines for "copy all": the up-command (key) or the invite
 * link + connect/manual steps (invite). */
function tailscaleCopyLines(
  bundle: FriendBundle,
  enroll: "key" | "invite",
): string[] {
  if (enroll === "key") {
    return bundle.tailscaleUpCommand
      ? ["", "Tailscale:", bundle.tailscaleUpCommand]
      : [];
  }
  return [
    "",
    inviteCopyHeader(bundle),
    ...(bundle.inviteUrl ? [`Accept: ${bundle.inviteUrl}`] : []),
    ...(bundle.manualInviteInstructions
      ? ["", bundle.manualInviteInstructions]
      : []),
  ];
}

/** Copy-all header line for an invite bundle — honest about what was sent. */
function inviteCopyHeader(bundle: FriendBundle): string {
  if (bundle.inviteEmailedAt) return `Invite emailed to ${bundle.inviteEmail}`;
  if (bundle.inviteUrl) return `Invite created for ${bundle.inviteEmail}`;
  return `No invite sent — invite ${bundle.inviteEmail} manually`;
}

function buildCopyAllText(
  bundle: FriendBundle,
  enroll: "key" | "invite",
): string {
  const creds = [
    `Access key: ${bundle.s3AccessKeyId}`,
    `Secret: ${bundle.s3SecretKey}`,
    `Endpoint: ${bundle.s3Endpoint}`,
    `Bucket: ${bundle.bucket}`,
  ];
  const tailscale = tailscaleCopyLines(bundle, enroll);
  const aclHeader = ["", "Tailscale ACL (paste into your policy):"];
  const acl = bundle.manualAclInstructions
    ? [...aclHeader, bundle.manualAclInstructions]
    : [];
  return [
    ...creds,
    ...tailscale,
    ...acl,
    "",
    "Kopia quickstart:",
    bundle.kopiaQuickstart,
  ].join("\n");
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
    }).catch((e) => {
      toastError(
        "Couldn't copy to clipboard",
        e instanceof Error ? e.message : String(e),
      );
    });
  };

  const authCmd = () => props.bundle.tailscaleUpCommand ?? "";

  const copyAll = () =>
    onCopy("all", buildCopyAllText(props.bundle, props.enroll));

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

        <ServerWarnings warnings={props.bundle.warnings} />

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
            bundle={props.bundle}
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
