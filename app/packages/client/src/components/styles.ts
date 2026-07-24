import { css } from "styled-system/css";

// Brand tokens: cyan accent, spark magenta, indigo canvas.
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
// Plain text nav tabs. Active state via [data-active] to reliably override base colour.
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

// Segmented Dark | Light toggle (matches the website App.tsx header).
export const segWrap = css({
  display: "inline-flex",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "full",
  p: "0.5",
});

// On Park Button (plain variant, needs px padding). Compact pill: overrides md height, neutralises plain's gray washes in all states; active pill re-pins cyan fill.
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

// Primary CTA: brand magenta spark + rounded-full pill + hover lift. _hover pins bg:spark so the recipe's cyan hover can't show.
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

// Space Mono regular weight — bold reads too heavy at 2xl.
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

// Shown in place of cardGrid when the friends list loads empty.
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

// Outline pills (a cyan fill reads murky on the dark canvas — outline is clean).
export const badgeActive = css({ color: "cyan.11", borderColor: "cyan.8" });

export const badgeFailed = css({
  color: "fg.error",
  borderColor: "border.error",
});

export const badgeNeutral = css({ color: "fg.muted" });

// Shared by AddPortion's ModePicker and EnrollPicker (radio-card grids).
export const hint = css({ fontSize: "xs", color: "fg.muted" });

export const modeGrid = css({
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "3",
});

// Each RadioGroup.Item as a selectable card; `_checked` marks the selected option (border + surface).
export const modeCard = css({
  textAlign: "left",
  p: "4",
  rounded: "l2",
  borderWidth: "1px",
  borderColor: "border.default",
  // Unselected cards recede: cool near-white in light (NOT the cream canvas),
  // page-indigo in dark. Selected pops to the card surface via _checked.
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
// The radio indicator sits at the far right of the card header.
export const radioDot = css({ ml: "auto", flexShrink: "0" });
