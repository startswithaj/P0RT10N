import { css } from "styled-system/css";

// A tiny faint activity sparkline for a Status-page row: last-24h hourly request
// counts. Idle (all-zero) rows draw a dashed baseline so it reads as "nothing to
// plot", not flatlined data.

const wrap = css({
  color: "fg.muted",
  opacity: "0.6",
  flexShrink: "0",
  // Block-level flex, not inline-flex: an inline box rests on the text baseline
  // and rides a few px above the row's status dot. A block flex item is centred
  // by the row's own `align-items: center`, level with the dot, no magic offset.
  display: "flex",
  alignItems: "center",
});

const W = 40;
const H = 18;
const MID = H / 2;

export function Sparkline(props: { data: number[] }) {
  const peak = () => Math.max(0, ...props.data);
  // A single point (or fewer) can't form a line, and an all-zero series has no
  // shape — both are "empty" and render as a dashed line on the mid baseline.
  const isEmpty = () => props.data.length < 2 || peak() === 0;

  const points = () => {
    // Idle: a dashed line on the mid baseline so it sits level with the status
    // dot. Active: volume anchored to the bottom — taller reads as busier.
    if (isEmpty()) return `0,${MID} ${W},${MID}`;
    const d = props.data;
    const n = d.length;
    const max = peak();
    // 1px inset top/bottom so the peak and baseline strokes aren't clipped.
    return d
      .map((v, i) => {
        const x = (i / (n - 1)) * W;
        const y = H - 1 - (v / max) * (H - 2);
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
