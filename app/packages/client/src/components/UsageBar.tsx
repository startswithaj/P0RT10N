import * as Progress from "./ui/progress.tsx";
import { pct } from "./helpers.ts";
import { barOk, barRoot, barTrack, barWarn } from "./styles.ts";

export function UsageBar(props: { fraction: number }) {
  // Park UI Progress (Ark) drives the Range width and sets aria-valuenow from the
  // value, so the old dynamic inline width style is gone. value is the usage % (max
  // defaults to 100); the warn colour still trips at >=90%.
  return (
    <Progress.Root value={pct(props.fraction)} class={barRoot}>
      <Progress.Track class={barTrack}>
        <Progress.Range class={props.fraction >= 0.9 ? barWarn : barOk} />
      </Progress.Track>
    </Progress.Root>
  );
}
