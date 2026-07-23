import { Show } from "solid-js";
import { Mail } from "lucide-solid";
import { CopyButton } from "./CopyButton.tsx";
import {
  aclEyebrow,
  codeBlock,
  codeBlockWrapped,
  codeCopy,
  codeWrap,
  inviteCol,
  inviteIcon,
  inviteNote,
} from "./bundle-styles.ts";
import { trpc } from "../trpc.ts";

type FriendBundle = Awaited<ReturnType<typeof trpc.friends.add.mutate>>;

// The header note, honest about what actually happened: emailed, created (link
// to share), or nothing sent (no token — invite by hand below).
function noteText(b: FriendBundle): string {
  if (b.inviteEmailedAt) {
    return `An invite has been emailed to ${b.inviteEmail} — they join with their own identity.`;
  }
  if (b.inviteUrl) {
    return `Invite created — share the link below with ${b.inviteEmail}.`;
  }
  return `No invite was sent automatically — invite ${b.inviteEmail} by hand below, then they join with their own identity.`;
}

// Invite-enrolled bundle's Tailscale block: the emailed/created note, the
// acceptance link, how the friend connects with their own account, and the
// no-token manual-invite console steps.
export function InviteBundleSection(
  props: {
    bundle: FriendBundle;
    copied: () => string | null;
    onCopy: (id: string, v: string) => void;
  },
) {
  const b = () => props.bundle;
  return (
    <div class={inviteCol}>
      <span class={inviteNote}>
        <span class={inviteIcon}>
          <Mail size={16} />
        </span>
        <span>{noteText(b())}</span>
      </span>
      <Show when={b().inviteUrl}>
        {(url) => (
          <div class={codeWrap}>
            <pre class={codeBlockWrapped}>{url()}</pre>
            <span class={codeCopy}>
              <CopyButton
                id="invite-url"
                value={url()}
                copied={props.copied}
                onCopy={props.onCopy}
              />
            </span>
          </div>
        )}
      </Show>
      <Show when={b().manualInviteInstructions}>
        {(instr) => (
          <>
            <div class={aclEyebrow}>Action needed — invite manually</div>
            <div class={codeWrap}>
              <pre class={codeBlock}>{instr()}</pre>
              <span class={codeCopy}>
                <CopyButton
                  id="manual-invite"
                  value={instr()}
                  copied={props.copied}
                  onCopy={props.onCopy}
                />
              </span>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
