import { Show } from "solid-js";
import { css } from "styled-system/css";
import { Check, Copy } from "lucide-solid";
import { IconButton } from "./ui/icon-button.tsx";

const copiedIcon = css({ color: "cyan.9" });

// Copy-to-clipboard icon button; flips to a check while `copied` matches its id.
export function CopyButton(
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
