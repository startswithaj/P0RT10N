import { css } from "styled-system/css";

// The letters use `logoInk`, which flips between cyan and indigo with the theme,
// while the magenta `spark` digits never flip.
export function Wordmark(props: { size?: number }) {
  const spark = css({ color: "spark" });
  return (
    <span
      class={css({ fontFamily: "display", color: "logoInk", lineHeight: "1" })}
      style={{ "font-size": `${props.size ?? 24}px` }}
    >
      p<span class={spark}>0</span>rt<span class={spark}>1</span>on
    </span>
  );
}
