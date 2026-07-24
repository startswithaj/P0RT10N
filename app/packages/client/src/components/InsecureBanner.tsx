import { createSignal, Show } from "solid-js";
import { css } from "styled-system/css";
import { AlertTriangle, X } from "lucide-solid";
import { IconButton } from "./ui/icon-button.tsx";

const DISMISS_KEY = "p0rt1on-insecure-dismissed";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

const banner = css({
  display: "flex",
  alignItems: "center",
  gap: "3",
  bg: "bg.default",
  color: "fg.default",
  borderBottomWidth: "2px",
  borderColor: "warning",
  px: "4",
  py: "3",
  fontSize: "sm",
});

const icon = css({ color: "warning", flexShrink: 0 });

// Shows when: no password is set AND you reached this page from another machine
// (your browser's address isn't localhost). That URL check is what keeps it
// accurate even in a container, where the app can't see its own exposure — the
// boot log carries the same warning for whoever launched it. Dismissal is
// remembered in localStorage (just a flag — no secret).
export function InsecureBanner(props: { noPassword: () => boolean }) {
  const fromNetwork = !LOCAL_HOSTS.includes(globalThis.location.hostname);
  const [dismissed, setDismissed] = createSignal(
    globalThis.localStorage.getItem(DISMISS_KEY) === "1",
  );
  const dismiss = () => {
    globalThis.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };
  return (
    <Show when={props.noPassword() && fromNetwork && !dismissed()}>
      <div class={banner}>
        <AlertTriangle size={18} class={icon} />
        <span>
          This admin panel has <strong>no password</strong>{" "}
          and you're viewing it over the network — anyone who can reach this
          machine can create or tear down your backups. Set{" "}
          <code>P0RT1ON_ADMIN_USERNAME</code> and{" "}
          <code>P0RT1ON_ADMIN_PASSWORD</code> to require a login.
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="Dismiss"
          onClick={dismiss}
          class={css({ ml: "auto", flexShrink: 0 })}
        >
          <X size={16} />
        </IconButton>
      </div>
    </Show>
  );
}
