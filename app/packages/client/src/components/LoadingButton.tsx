import { splitProps } from "solid-js";
import { css } from "styled-system/css";
import { Button, type ButtonProps } from "./ui/button.tsx";

// A looping loader painted onto the button's border while `loading`: a
// conic-gradient arc, masked to a 2px ring, whose start angle (--p0-angle,
// registered in index.css) is animated by the `border-spin` keyframe so the
// highlight travels around the perimeter. Unlike Park's built-in `loading`
// (which swaps the label for a spinner), the label stays put underneath.
const loadingBorder = css({
  position: "relative",
  _before: {
    content: '""',
    position: "absolute",
    inset: "0",
    borderRadius: "inherit",
    padding: "2px",
    background:
      "conic-gradient(from var(--p0-angle), transparent 0%, transparent 65%, currentColor 100%)",
    mask: "linear-gradient(black 0 0) content-box, linear-gradient(black 0 0)",
    maskComposite: "exclude",
    WebkitMaskComposite: "xor",
    animation: "border-spin 900ms linear infinite",
    pointerEvents: "none",
  },
});

/** A Button that shows an animated border loader (and disables) while `loading`. */
export function LoadingButton(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    "loading",
    "class",
    "children",
    "disabled",
  ]);

  return (
    <Button
      {...rest}
      disabled={local.loading || local.disabled}
      class={[local.class, local.loading && loadingBorder].filter(Boolean)
        .join(" ")}
    >
      {local.children}
    </Button>
  );
}
