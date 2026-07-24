import { Button } from "./ui/button.tsx";
import { LoadingButton } from "./LoadingButton.tsx";
import { actionsRow, sparkBtn } from "./action-dialog-shared.ts";

/**
 * Cancel + confirm row shared by the action dialogs' confirm view.
 * `destructive` → danger-red palette (offboard); otherwise brand spark.
 * Shows the border loader while `busy`.
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
