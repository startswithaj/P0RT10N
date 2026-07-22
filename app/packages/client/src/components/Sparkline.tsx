import { css } from "styled-system/css";

// A tiny faint activity sparkline for a Status-page row: last-24h hourly request
// counts. Idle (all-zero) rows draw a dashed baseline — a solid flat line reads
// as real flatlined data, a dash reads as "nothing to plot".

const wrap = css({
  color: "fg.muted",
  opacity: "0.6",
  flexShrink: "0",
  display: "inline-flex",
});

const W = 40;
const H = 18;

export function Sparkline(props: { data: number[] }) {
  const peak = () => Math.max(0, ...props.data);
  // A single point (or fewer) can't form a line, and an all-zero series has no
  // shape — both are "empty" and render as a dashed baseline instead.
  const isEmpty = () => props.data.length < 2 || peak() === 0;

  const points = () => {
    if (isEmpty()) return `0,${H - 1} ${W},${H - 1}`;
    const d = props.data;
    const n = d.length;
    // 1px inset top/bottom so the peak and baseline strokes aren't clipped.
    return d
      .map((v, i) => {
        const x = (i / (n - 1)) * W;
        const y = H - 1 - (v / peak()) * (H - 2);
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
