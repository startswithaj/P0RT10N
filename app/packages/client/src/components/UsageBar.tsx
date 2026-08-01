import * as Progress from "./ui/progress.tsx";
import { pct } from "./helpers.ts";
import { barOk, barRoot, barTrack, barWarn } from "./styles.ts";

export function UsageBar(props: { fraction: number }) {
  // Park UI's Progress derives the range width and aria-valuenow from value, our usage
  // percentage out of 100; the warning color trips at 90% or higher.
  return (
    <Progress.Root value={pct(props.fraction)} class={barRoot}>
      <Progress.Track class={barTrack}>
        <Progress.Range class={props.fraction >= 0.9 ? barWarn : barOk} />
      </Progress.Track>
    </Progress.Root>
  );
}
