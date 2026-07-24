import * as Progress from "./ui/progress.tsx";
import { pct } from "./helpers.ts";
import { barOk, barRoot, barTrack, barWarn } from "./styles.ts";

export function UsageBar(props: { fraction: number }) {
  // Park UI Progress drives Range width + aria-valuenow from value (usage %, max 100). Warn colour trips at >=90%.
  return (
    <Progress.Root value={pct(props.fraction)} class={barRoot}>
      <Progress.Track class={barTrack}>
        <Progress.Range class={props.fraction >= 0.9 ? barWarn : barOk} />
      </Progress.Track>
    </Progress.Root>
  );
}
