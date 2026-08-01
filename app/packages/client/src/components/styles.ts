import { css } from "styled-system/css";

export const page = css({
  minH: "100dvh",
  bg: "bg.canvas",
  color: "fg.default",
  fontFamily: "body",
});

export const shell = css({ maxW: "6xl", mx: "auto", px: "8" });

export const nav = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  py: "5",
});

export const lockup = css({ display: "flex", alignItems: "center", gap: "3" });
// [data-active] is used here instead of a conditional class so it reliably overrides the base color.
export const tabs = css({ display: "flex", gap: "5" });

// Sizing/bg from the button recipe's `link` variant; this class only sets nav colours.
export const tabLink = css({
  fontFamily: "body",
  fontSize: "sm",
  color: "fg.muted",
  _hover: { color: "fg.default" },
  "&[data-active='true']": { color: "fg.default", fontWeight: "bold" },
});

export const actions = css({ display: "flex", gap: "6", alignItems: "center" });

export const segWrap = css({
  display: "inline-flex",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "full",
  p: "0.5",
});

// The plain Button variant applies gray washes on hover/active by default;
// each state below re-pins its own color to neutralize that.
export const segBtn = css({
  fontFamily: "body",
  fontSize: "xs",
  letterSpacing: "0.06em",
  h: "auto",
  px: "3",
  py: "1.5",
  rounded: "full",
  cursor: "pointer",
  bg: "transparent",
  color: "fg.muted",
  _hover: { color: "fg.default", bg: "transparent" },
  _active: { bg: "transparent" },
  _on: { bg: "transparent" },
  "&[data-active='true']": {
    bg: "cyan.9",
    color: "onAccent",
    _hover: { color: "onAccent", bg: "cyan.9" },
    _active: { bg: "cyan.9" },
  },
});

// _hover pins bg:spark so the recipe's cyan hover can't show.
export const sparkBtn = css({
  rounded: "full",
  bg: "spark",
  color: "white",
  transition: "transform 0.12s ease",
  _hover: { bg: "spark", transform: "translateY(-1px)" },
});

export const cardReset = css({
  boxShadow: "lg",
  borderWidth: "1px",
  borderColor: "border.default",
  bg: "bg.default",
});

export const statGrid = css({
  display: "grid",
  gridTemplateColumns: { base: "1fr", sm: "repeat(3, 1fr)" },
  gap: "4",
  mt: "8",
  mb: "12",
});

export const statBody = css({
  p: "5",
});

export const statTop = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  color: "fg.muted",
  fontSize: "xs",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  mb: "3",
});

export const statValue = css({
  fontSize: "2xl",
  fontWeight: "normal",
  lineHeight: "1.1",
});

export const statSub = css({
  fontSize: "sm",
  color: "fg.muted",
  fontWeight: "normal",
});

export const sectionTitle = css({
  fontFamily: "display",
  fontSize: "xl",
  color: "fg.default",
  mb: "5",
});

export const cardGrid = css({
  display: "grid",
  gridTemplateColumns: {
    base: "1fr",
    md: "repeat(2, 1fr)",
    xl: "repeat(3, 1fr)",
  },
  gap: "4",
});

export const emptyState = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "3",
  py: "16",
  color: "fg.muted",
  borderWidth: "1px",
  borderStyle: "dashed",
  borderColor: "border.default",
  rounded: "l2",
});

export const emptyTitle = css({ color: "fg.default", fontWeight: "bold" });
export const headPad = css({ px: "6", pt: "6", pb: "0" });

export const headRow = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "2",
});

export const headRight = css({
  display: "flex",
  gap: "2",
  alignItems: "center",
});

export const titleText = css({ fontWeight: "bold", fontSize: "md" });

export const bodyStack = css({
  display: "flex",
  flexDirection: "column",
  gap: "3",
  px: "6",
  pt: "4",
  pb: "6",
});

export const usageRow = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  fontSize: "sm",
});

export const barRoot = css({ w: "full" });

export const barTrack = css({
  h: "2",
  w: "full",
  rounded: "full",
  bg: "bg.muted",
  overflow: "hidden",
});

export const barOk = css({ h: "full", bg: "cyan.9", rounded: "full" });
export const barWarn = css({ h: "full", bg: "spark", rounded: "full" });

export const metaRow = css({
  display: "flex",
  justifyContent: "space-between",
  color: "fg.muted",
  fontSize: "sm",
});

export const metaItem = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
});

export const staleWarn = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
  fontSize: "xs",
  color: "warning",
});

export const staleNeutral = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "1.5",
  fontSize: "xs",
  color: "fg.muted",
});

export const iconBtn = css({
  display: "grid",
  placeItems: "center",
  w: "8",
  h: "8",
  rounded: "l2",
  color: "fg.muted",
  cursor: "pointer",
  _hover: { bg: "bg.muted", color: "fg.default" },
});

export const menuItem = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
});

export const dangerItem = css({ color: "fg.error" });

export const badgeActive = css({ color: "cyan.11", borderColor: "cyan.8" });

export const badgeFailed = css({
  color: "fg.error",
  borderColor: "border.error",
});

export const badgeNeutral = css({ color: "fg.muted" });

export const hint = css({ fontSize: "xs", color: "fg.muted" });

export const modeGrid = css({
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "3",
});

export const modeCard = css({
  textAlign: "left",
  p: "4",
  rounded: "l2",
  borderWidth: "1px",
  borderColor: "border.default",
  bg: { base: "gray.2", _dark: "bg.canvas" },
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: "1.5",
  _hover: { borderColor: "border.outline" },
  _checked: { borderColor: "cyan.9", bg: "bg.default" },
});

export const modeHead = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  fontWeight: "bold",
  fontSize: "sm",
  color: "fg.default",
});

export const modeIcon = css({ color: "cyan.9" });
export const radioDot = css({ ml: "auto", flexShrink: "0" });
