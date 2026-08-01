import { css } from "styled-system/css";

const wrap = css({
  color: "fg.muted",
  opacity: "0.6",
  flexShrink: "0",
  // This uses block-level flex instead of inline-flex because an inline box rides
  // above the row's status dot; block flex is centered by the row's align-items.
  display: "flex",
  alignItems: "center",
});

const W = 40;
const H = 18;
const MID = H / 2;

export function Sparkline(props: { data: number[] }) {
  const peak = () => Math.max(0, ...props.data);
  // A single point or an all-zero series has no shape to plot, so both are
  // treated as empty and rendered as a dashed line on the mid baseline.
  const isEmpty = () => props.data.length < 2 || peak() === 0;

  const points = () => {
    // When idle it draws a dashed line level with the status dot; when active
    // it anchors volume to the bottom, so a taller line reads as busier.
    if (isEmpty()) return `0,${MID} ${W},${MID}`;
    const d = props.data;
    const n = d.length;
    const max = peak();
    // A 1px inset on top and bottom keeps the peak and baseline strokes from clipping.
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
