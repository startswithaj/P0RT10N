import { For } from "solid-js";
import { css } from "styled-system/css";
import { Button } from "./ui/button.tsx";
import * as Field from "./ui/field.tsx";
import * as NumberInput from "./ui/number-input.tsx";

const chips = css({ display: "flex", gap: "2", flexWrap: "wrap" });
const PRESETS = [10, 30, 50, 100];

export function QuotaField(
  props: {
    quota: () => number;
    setQuota: (n: number) => void;
    error: () => string | null;
  },
) {
  return (
    <Field.Root invalid={props.error() !== null}>
      <Field.Label>Storage quota (GB)</Field.Label>
      <div class={chips}>
        <For each={PRESETS}>
          {(gb) => (
            <Button
              type="button"
              size="sm"
              variant={props.quota() === gb ? "solid" : "outline"}
              onClick={() => props.setQuota(gb)}
            >
              {gb} GB
            </Button>
          )}
        </For>
      </div>
      <NumberInput.Root
        min={1}
        value={Number.isNaN(props.quota()) ? "" : String(props.quota())}
        formatOptions={{ maximumFractionDigits: 0 }}
        onValueChange={(d) => props.setQuota(d.valueAsNumber)}
      >
        {
          /* Input is a sibling of Control; Control is only the
            absolutely-positioned stepper column (triggers). */
        }
        <NumberInput.Input />
        <NumberInput.Control>
          <NumberInput.IncrementTrigger />
          <NumberInput.DecrementTrigger />
        </NumberInput.Control>
      </NumberInput.Root>
      <Field.ErrorText>Must be a positive whole number of GB</Field.ErrorText>
    </Field.Root>
  );
}
