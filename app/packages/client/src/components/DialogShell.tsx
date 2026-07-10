import { type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import * as Dialog from "./ui/dialog.tsx";
import { body, contentShadow, dimBackdrop } from "./action-dialog-shared.ts";

/**
 * The modal frame shared by every action dialog: dimmed backdrop, floating
 * panel, title, and Enter-to-confirm on the body. Enter is ignored on a focused
 * button so Enter-on-Cancel still cancels; the owning dialog's `onEnter` decides
 * whether the preconditions are met.
 */
export function DialogShell(props: {
  title: string;
  onClose: () => void;
  onEnter?: () => void;
  children: JSX.Element;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !props.onEnter) return;
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    e.preventDefault();
    props.onEnter();
  };

  return (
    <Dialog.Root open onOpenChange={(d) => !d.open && props.onClose()}>
      <Portal>
        <Dialog.Backdrop class={dimBackdrop} />
        <Dialog.Positioner>
          <Dialog.Content class={contentShadow}>
            <div class={body} onKeyDown={onKeyDown}>
              <Dialog.Title>{props.title}</Dialog.Title>
              {props.children}
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
