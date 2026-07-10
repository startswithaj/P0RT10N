import { Show } from "solid-js";
import { OFFBOARD_STEPS } from "@p0rt1on/shared/steps";
import { Button } from "./ui/button.tsx";
import { StepChecklist, stepStatusFor } from "./StepChecklist.tsx";
import {
  actionsRow,
  desc,
  errText,
  OFFBOARD_LABELS,
  type OffboardState,
} from "./action-dialog-shared.ts";

/** Live teardown checklist shown in the dialog once offboarding starts. */
export function OffboardProgressBody(props: {
  name: string;
  state: () => OffboardState;
  onClose: () => void;
}) {
  const failed = () => props.state().kind === "error";
  const activeIndex = () => {
    const s = props.state();
    const step = s.kind === "running" || s.kind === "error" ? s.step : null;
    return step === null ? 0 : OFFBOARD_STEPS.findIndex((x) => x.key === step);
  };
  const message = () => {
    const s = props.state();
    return s.kind === "error" ? s.message : null;
  };
  return (
    <>
      <p class={desc}>
        <Show
          when={failed()}
          fallback={`Tearing down ${props.name}'s bucket, keys and node…`}
        >
          Offboarding failed partway — some resources may remain.
        </Show>
      </p>
      <StepChecklist
        steps={OFFBOARD_LABELS}
        status={stepStatusFor(activeIndex(), failed())}
      />
      <Show when={message()}>
        <p class={errText}>{message()}</p>
      </Show>
      <Show when={failed()}>
        <div class={actionsRow}>
          <Button variant="outline" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </Show>
    </>
  );
}
