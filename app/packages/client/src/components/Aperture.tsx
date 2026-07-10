import { css } from "styled-system/css";
import { token } from "styled-system/tokens";

// Brand aperture ring from assets/svg. The ring uses `logoInk` (flips
// cyan↔indigo with the theme); the magenta `spark` wedge + dot never flip.
export function Aperture(props: { size?: number }) {
  const s = props.size ?? 36;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 320 320"
      class={css({ color: "logoInk", display: "block" })}
      aria-hidden="true"
    >
      {/* C-ring with the slice cut out (ink flips); magenta wedge + dot fill it */}
      <path
        d="M 288.514 125.750 A 133 133 0 1 1 157.500 27.023 L 157.500 61.032 A 99 99 0 1 0 255.824 135.124 Z"
        fill="currentColor"
      />
      <path
        d="M 162.500 27.023 A 133 133 0 0 1 287.136 120.944 L 254.445 130.317 A 99 99 0 0 0 162.500 61.032 Z"
        fill={token("colors.spark")}
      />
      <circle cx="160" cy="160" r="52" fill={token("colors.spark")} />
    </svg>
  );
}
