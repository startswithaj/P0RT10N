import { type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import * as Dialog from "./ui/dialog.tsx";
import {
  body,
  bodyWide,
  contentShadow,
  dimBackdrop,
} from "./action-dialog-shared.ts";

/**
 * Enter is ignored when a button has focus, so Enter on Cancel still cancels.
 * The owning dialog's `onEnter` callback decides whether preconditions are met.
 */
export function DialogShell(props: {
  title: string;
  onClose: () => void;
  onEnter?: () => void;
  /** Wider frame for code-block-heavy dialogs (offboard advice). */
  wide?: boolean;
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
            <div class={props.wide ? bodyWide : body} onKeyDown={onKeyDown}>
              <Dialog.Title>{props.title}</Dialog.Title>
              {props.children}
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
