import { Button } from "./ui/button.tsx";
import { LoadingButton } from "./LoadingButton.tsx";
import { actionsRow, sparkBtn } from "./action-dialog-shared.ts";

/**
 * The Cancel + confirm button row shared by the action dialogs' confirm view.
 * `destructive` gives the confirm button the danger-red palette (offboard);
 * every other action takes the brand spark colour. The button shows the border
 * loader while `busy`.
 */
export function ConfirmActions(props: {
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div class={actionsRow}>
      <Button variant="outline" onClick={props.onCancel}>
        Cancel
      </Button>
      <LoadingButton
        colorPalette={props.destructive ? "red" : undefined}
        class={props.destructive ? undefined : sparkBtn}
        loading={props.busy}
        disabled={props.disabled}
        onClick={props.onConfirm}
      >
        {props.confirmLabel}
      </LoadingButton>
    </div>
  );
}
