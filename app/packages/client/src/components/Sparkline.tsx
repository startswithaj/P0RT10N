import { css } from "styled-system/css";

// A tiny faint activity sparkline for a Status-page row: last-24h hourly request
// counts. Idle (all-zero) rows draw a dashed baseline — a solid flat line reads
// as real flatlined data, a dash reads as "nothing to plot".

const wrap = css({
  color: "fg.muted",
  opacity: "0.6",
  flexShrink: "0",
  display: "inline-flex",
  // Sit level with the row's status dot: middle-align the inline box, then nudge
  // it down 3px to offset the residual baseline lift (found by inspection).
  verticalAlign: "middle",
  mb: "3px",
});

const W = 40;
const H = 18;
// The line is centred on the mid-height so it sits level with the row's status
// dot: an idle row is flat on that line, activity deviates above and below it.
const MID = H / 2;

export function Sparkline(props: { data: number[] }) {
  const peak = () => Math.max(0, ...props.data);
  // A single point (or fewer) can't form a line, and an all-zero series has no
  // shape — both are "empty" and render as a dashed line on the mid baseline.
  const isEmpty = () => props.data.length < 2 || peak() === 0;

  const points = () => {
    if (isEmpty()) return `0,${MID} ${W},${MID}`;
    const d = props.data;
    const n = d.length;
    const mean = d.reduce((sum, v) => sum + v, 0) / n;
    // Deviation from the mean, scaled so the largest swing reaches 1px from the
    // edge; centres the waveform on MID so it lines up with the status dot.
    const amp = Math.max(1, ...d.map((v) => Math.abs(v - mean)));
    return d
      .map((v, i) => {
        const x = (i / (n - 1)) * W;
        const y = MID - ((v - mean) / amp) * (MID - 1);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  return (
    <span class={wrap}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
        <polyline
          points={points()}
          stroke="currentColor"
          stroke-width="1"
          stroke-linejoin="round"
          stroke-linecap="round"
          stroke-dasharray={isEmpty() ? "2 2" : undefined}
        />
      </svg>
    </span>
  );
}
