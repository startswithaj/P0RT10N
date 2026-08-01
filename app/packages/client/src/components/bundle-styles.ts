import { css } from "styled-system/css";

export const section = css({ mb: "6" });

export const eyebrow = css({
  fontSize: "xs",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "fg.muted",
  mb: "2",
});

export const codeWrap = css({ position: "relative" });

// This stays a plain object so callers can merge a wrapping override with css(base,
// override), since Panda's `cx` only concatenates class names instead of resolving styles.
const codeBlockStyles = {
  fontFamily: "body",
  fontSize: "xs",
  lineHeight: "1.9",
  color: "fg.default",
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  p: "4",
  pr: "12",
  overflowX: "auto",
  whiteSpace: "pre",
  boxShadow: "lg",
} as const;

export const codeBlock = css(codeBlockStyles);

// The auth key is one long unbroken token, so this wraps it rather than scrolling,
// stopping at the reserved right padding instead of running under the copy button.
export const codeBlockWrapped = css(codeBlockStyles, {
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
});

export const codeCopy = css({ position: "absolute", top: "2.5", right: "2.5" });

export const inviteCol = css({
  display: "flex",
  flexDirection: "column",
  gap: "3",
});

export const inviteNote = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  fontSize: "sm",
  color: "fg.muted",
});

export const inviteIcon = css({ color: "cyan.9" });

export const aclEyebrow = css({
  fontSize: "xs",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "spark",
  mb: "2",
});
