// ============================================================================
// GENERATED FILE — DO NOT EDIT BY HAND. Edits are lost on regeneration.
// ============================================================================
//
// This is the entire Park UI theme (recipes, tokens, semantic tokens,
// conditions, globalCss), vendored as project source. It is the exact output
// of the discontinued @park-ui/panda-preset@0.43.1 package's
//   createPreset({ accentColor: brandCyan, grayColor: slate, radius: "md" })
// serialized to disk by extract-legacy-preset.ts. Upstream froze that package
// in Nov 2024, so this file never changes unless we change our inputs.
//
// HOW TO CHANGE THE THEME:
//  - Brand accent colors   -> edit src/theme/cyan-brand.ts, then regenerate.
//  - Gray scale / radius   -> edit the createPreset args in
//                             extract-legacy-preset.ts, then regenerate.
//  - One-off recipe tweaks -> DON'T edit here; add a patch under theme.extend
//                             in panda.config.ts (see the SKEW PATCHES comment
//                             there for the pattern).
//
// REGENERATE:
//   cd app/packages/client
//   deno run -A extract-legacy-preset.ts
//   deno fmt src/theme/park-preset.generated.ts
// ============================================================================
import type { Preset } from "@pandacss/dev";

export const parkLegacyPreset = {
  "name": "@park-ui/panda-preset",
  "presets": [
    "@pandacss/preset-base",
  ],
  "conditions": {
    "extend": {
      "collapsed":
        '&:is([aria-collapsed=true], [data-collapsed], [data-state="collapsed"])',
      "current": "&:is([data-current])",
      "hidden": "&:is([hidden])",
      "hover": [
        "@media (hover: hover) and (pointer: fine)",
        "&:is(:hover, [data-hover])",
      ],
      "indeterminate":
        "&:is(:indeterminate, [data-indeterminate], [aria-checked=mixed], [data-state=indeterminate])",
      "off": '&:is([data-state="off"])',
      "on": '&:is([data-state="on"])',
      "today": "&:is([data-today])",
      "underValue": '&:is([data-state="under-value"])',
      "dark": ".dark &",
      "light": ":root &, .light &",
      "invalid": "&:is([aria-invalid])",
    },
  },
  "globalCss": {
    "body": {
      "background": "bg.canvas",
      "color": "fg.default",
      "_dark": {
        "colorScheme": "dark",
      },
    },
    "*, *::before, *::after": {
      "borderColor": "border.subtle",
      "borderStyle": "solid",
      "boxSizing": "border-box",
    },
    "*::placeholder": {
      "opacity": 1,
      "color": "fg.subtle",
    },
    "*::selection": {
      "bg": "accent.a4",
    },
    "html": {
      "colorPalette": "brandcyan",
    },
  },
  "theme": {
    "extend": {
      "breakpoints": {
        "sm": "640px",
        "md": "768px",
        "lg": "1024px",
        "xl": "1280px",
        "2xl": "1536px",
      },
      "keyframes": {
        "fade-in": {
          "from": {
            "opacity": "0",
          },
          "to": {
            "opacity": "1",
          },
        },
        "fade-out": {
          "from": {
            "opacity": "1",
          },
          "to": {
            "opacity": "0",
          },
        },
        "slide-in": {
          "0%": {
            "opacity": "0",
            "transform": "translateY(64px)",
          },
          "100%": {
            "opacity": "1",
            "transform": "translateY(0)",
          },
        },
        "slide-out": {
          "0%": {
            "opacity": "1",
            "transform": "translateY(0)",
          },
          "100%": {
            "opacity": "0",
            "transform": "translateY(64px)",
          },
        },
        "slide-in-left": {
          "0%": {
            "transform": "translateX(-100%)",
          },
          "100%": {
            "transform": "translateX(0%)",
          },
        },
        "slide-out-left": {
          "0%": {
            "transform": "translateX(0%)",
          },
          "100%": {
            "transform": "translateX(-100%)",
          },
        },
        "slide-in-right": {
          "0%": {
            "transform": "translateX(100%)",
          },
          "100%": {
            "transform": "translateX(0%)",
          },
        },
        "slide-out-right": {
          "0%": {
            "transform": "translateX(0%)",
          },
          "100%": {
            "transform": "translateX(100%)",
          },
        },
        "collapse-in": {
          "0%": {
            "height": "0",
          },
          "100%": {
            "height": "var(--height)",
          },
        },
        "collapse-out": {
          "0%": {
            "height": "var(--height)",
          },
          "100%": {
            "height": "0",
          },
        },
        "fadeIn": {
          "0%": {
            "opacity": "0",
            "transform": "translateY(-4px)",
          },
          "100%": {
            "opacity": "1",
            "transform": "translateY(0)",
          },
        },
        "fadeOut": {
          "0%": {
            "opacity": "1",
            "transform": "translateY(0)",
          },
          "100%": {
            "opacity": "0",
            "transform": "translateY(-4px)",
          },
        },
        "skeleton-pulse": {
          "50%": {
            "opacity": "0.5",
          },
        },
        "spin": {
          "0%": {
            "transform": "rotate(0deg)",
          },
          "100%": {
            "transform": "rotate(360deg)",
          },
        },
      },
      "recipes": {
        "badge": {
          "className": "badge",
          "base": {
            "alignItems": "center",
            "borderRadius": "full",
            "display": "inline-flex",
            "fontWeight": "medium",
            "userSelect": "none",
            "whiteSpace": "nowrap",
          },
          "defaultVariants": {
            "variant": "subtle",
            "size": "md",
          },
          "variants": {
            "variant": {
              "solid": {
                "background": "colorPalette.default",
                "color": "colorPalette.fg",
              },
              "subtle": {
                "background": "bg.subtle",
                "borderColor": "border.subtle",
                "borderWidth": "1px",
                "color": "fg.default",
                "& svg": {
                  "color": "fg.muted",
                },
              },
              "outline": {
                "color": "fg.default",
                "borderWidth": "2px",
                "borderColor": "border.default",
              },
            },
            "size": {
              "sm": {
                "textStyle": "xs",
                "px": "2",
                "h": "5",
                "gap": "1",
                "& svg": {
                  "width": "3",
                  "height": "3",
                },
              },
              "md": {
                "textStyle": "xs",
                "px": "2.5",
                "h": "6",
                "gap": "1.5",
                "& svg": {
                  "width": "4",
                  "height": "4",
                },
              },
              "lg": {
                "textStyle": "sm",
                "px": "3",
                "h": "7",
                "gap": "1.5",
                "& svg": {
                  "width": "4",
                  "height": "4",
                },
              },
            },
          },
        },
        "button": {
          "className": "button",
          "jsx": [
            "Button",
            "IconButton",
            "SubmitButton",
          ],
          "base": {
            "alignItems": "center",
            "appearance": "none",
            "borderRadius": "l2",
            "cursor": "pointer",
            "display": "inline-flex",
            "flexShrink": "0",
            "fontWeight": "semibold",
            "isolation": "isolate",
            "minWidth": "0",
            "justifyContent": "center",
            "outline": "none",
            "position": "relative",
            "transitionDuration": "normal",
            "transitionProperty": "background, border-color, color, box-shadow",
            "transitionTimingFunction": "default",
            "userSelect": "none",
            "verticalAlign": "middle",
            "whiteSpace": "nowrap",
            "_hidden": {
              "display": "none",
            },
            "& :where(svg)": {
              "fontSize": "1.1em",
              "width": "1.1em",
              "height": "1.1em",
            },
          },
          "defaultVariants": {
            "variant": "solid",
            "size": "md",
          },
          "variants": {
            "variant": {
              "solid": {
                "background": "colorPalette.default",
                "color": "colorPalette.fg",
                "_hover": {
                  "background": "colorPalette.emphasized",
                },
                "_focusVisible": {
                  "outline": "2px solid",
                  "outlineColor": "colorPalette.default",
                  "outlineOffset": "2px",
                },
                "_disabled": {
                  "color": "fg.disabled",
                  "background": "bg.disabled",
                  "cursor": "not-allowed",
                  "_hover": {
                    "color": "fg.disabled",
                    "background": "bg.disabled",
                  },
                },
              },
              "outline": {
                "borderWidth": "1px",
                "borderColor": "colorPalette.a7",
                "color": "colorPalette.text",
                "colorPalette": "gray",
                "_hover": {
                  "background": "colorPalette.a2",
                },
                "_disabled": {
                  "borderColor": "border.disabled",
                  "color": "fg.disabled",
                  "cursor": "not-allowed",
                  "_hover": {
                    "background": "transparent",
                    "borderColor": "border.disabled",
                    "color": "fg.disabled",
                  },
                },
                "_focusVisible": {
                  "outline": "2px solid",
                  "outlineColor": "colorPalette.default",
                  "outlineOffset": "2px",
                },
                "_selected": {
                  "background": "accent.default",
                  "borderColor": "accent.default",
                  "color": "accent.fg",
                  "_hover": {
                    "background": "accent.emphasized",
                    "borderColor": "accent.emphasized",
                  },
                },
              },
              "ghost": {
                "color": "colorPalette.text",
                "colorPalette": "gray",
                "_hover": {
                  "background": "colorPalette.a3",
                },
                "_selected": {
                  "background": "colorPalette.a3",
                },
                "_disabled": {
                  "color": "fg.disabled",
                  "cursor": "not-allowed",
                  "_hover": {
                    "background": "transparent",
                    "color": "fg.disabled",
                  },
                },
                "_focusVisible": {
                  "outline": "2px solid",
                  "outlineColor": "colorPalette.default",
                  "outlineOffset": "2px",
                },
              },
              "link": {
                "verticalAlign": "baseline",
                "_disabled": {
                  "color": "border.disabled",
                  "cursor": "not-allowed",
                  "_hover": {
                    "color": "border.disabled",
                  },
                },
                "height": "auto!",
                "px": "0!",
                "minW": "0!",
              },
              "subtle": {
                "background": "colorPalette.a3",
                "color": "colorPalette.text",
                "colorPalette": "gray",
                "_hover": {
                  "background": "colorPalette.a4",
                },
                "_focusVisible": {
                  "outline": "2px solid",
                  "outlineColor": "colorPalette.default",
                  "outlineOffset": "2px",
                },
                "_disabled": {
                  "background": "bg.disabled",
                  "color": "fg.disabled",
                  "cursor": "not-allowed",
                  "_hover": {
                    "background": "bg.disabled",
                    "color": "fg.disabled",
                  },
                },
              },
            },
            "size": {
              "xs": {
                "h": "8",
                "minW": "8",
                "textStyle": "xs",
                "px": "3",
                "gap": "2",
              },
              "sm": {
                "h": "9",
                "minW": "9",
                "textStyle": "sm",
                "px": "3.5",
                "gap": "2",
              },
              "md": {
                "h": "10",
                "minW": "10",
                "textStyle": "sm",
                "px": "4",
                "gap": "2",
              },
              "lg": {
                "h": "11",
                "minW": "11",
                "textStyle": "md",
                "px": "4.5",
                "gap": "2",
              },
              "xl": {
                "h": "12",
                "minW": "12",
                "textStyle": "md",
                "px": "5",
                "gap": "2.5",
              },
              "2xl": {
                "h": "16",
                "minW": "16",
                "textStyle": "lg",
                "px": "7",
                "gap": "3",
              },
            },
          },
        },
        "code": {
          "className": "code",
          "base": {
            "alignItems": "center",
            "bg": "bg.subtle",
            "borderRadius": "l2",
            "color": "fg.default",
            "display": "inline-flex",
            "fontWeight": "medium!",
            "fontFamily": "var(--fonts-code)",
            "whiteSpace": "pre",
          },
          "defaultVariants": {
            "size": "md",
            "variant": "outline",
          },
          "variants": {
            "variant": {
              "outline": {
                "borderWidth": "1px",
              },
              "ghost": {},
            },
            "size": {
              "sm": {
                "minHeight": "5",
                "px": "0.5",
                "textStyle": "xs",
              },
              "md": {
                "minHeight": "6",
                "textStyle": "sm",
                "px": "1",
                "py": "1px",
              },
              "lg": {
                "minHeight": "7",
                "px": "1.5",
                "py": "1px",
                "textStyle": "md",
              },
            },
          },
        },
        "formLabel": {
          "className": "formLabel",
          "base": {
            "color": "fg.default",
            "fontWeight": "medium",
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "textStyle": "sm",
              },
              "md": {
                "textStyle": "sm",
              },
              "lg": {
                "textStyle": "sm",
              },
              "xl": {
                "textStyle": "md",
              },
            },
          },
        },
        "icon": {
          "className": "icon",
          "base": {
            "color": "currentcolor",
            "display": "inline-block",
            "flexShrink": "0",
            "verticalAlign": "middle",
            "lineHeight": "1em",
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "xs": {
                "w": "3",
                "h": "3",
              },
              "sm": {
                "w": "4",
                "h": "4",
              },
              "md": {
                "w": "5",
                "h": "5",
              },
              "lg": {
                "w": "6",
                "h": "6",
              },
              "xl": {
                "w": "7",
                "h": "7",
              },
              "2xl": {
                "w": "8",
                "h": "8",
              },
            },
          },
        },
        "input": {
          "className": "input",
          "jsx": [
            "Input",
            "Field.Input",
          ],
          "base": {
            "appearance": "none",
            "background": "none",
            "borderColor": "border.default",
            "borderRadius": "l2",
            "borderWidth": "1px",
            "color": "fg.default",
            "outline": 0,
            "position": "relative",
            "transitionDuration": "normal",
            "transitionProperty": "box-shadow, border-color",
            "transitionTimingFunction": "default",
            "width": "full",
            "_disabled": {
              "opacity": 0.4,
              "cursor": "not-allowed",
            },
            "_focus": {
              "borderColor": "colorPalette.default",
              "boxShadow": "0 0 0 1px var(--colors-color-palette-default)",
            },
            "_invalid": {
              "borderColor": "fg.error",
              "_focus": {
                "borderColor": "fg.error",
                "boxShadow": "0 0 0 1px var(--colors-border-error)",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "2xs": {
                "px": "1.5",
                "h": "7",
                "minW": "7",
                "fontSize": "xs",
              },
              "xs": {
                "px": "2",
                "h": "8",
                "minW": "8",
                "fontSize": "xs",
              },
              "sm": {
                "px": "2.5",
                "h": "9",
                "minW": "9",
                "fontSize": "sm",
              },
              "md": {
                "px": "3",
                "h": "10",
                "minW": "10",
                "fontSize": "md",
              },
              "lg": {
                "px": "3.5",
                "h": "11",
                "minW": "11",
                "fontSize": "md",
              },
              "xl": {
                "px": "4",
                "h": "12",
                "minW": "12",
                "fontSize": "lg",
              },
              "2xl": {
                "px": "4.5",
                "h": "16",
                "minW": "16",
                "textStyle": "3xl",
              },
            },
          },
        },
        "kbd": {
          "className": "kbd",
          "base": {
            "alignItems": "center",
            "bg": "bg.subtle",
            "borderRadius": "l2",
            "boxShadow":
              "0 -2px 0 0 inset var(--colors-border-muted), 0 0 0 1px inset var(--colors-border-muted)",
            "color": "fg.default",
            "display": "inline-flex",
            "fontFamily": "var(--fonts-code)",
            "fontWeight": "medium",
            "whiteSpace": "pre",
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "minHeight": "5",
                "px": "0.5",
                "textStyle": "xs",
              },
              "md": {
                "minHeight": "6",
                "textStyle": "sm",
                "px": "1",
                "py": "1px",
              },
              "lg": {
                "minHeight": "7",
                "px": "1.5",
                "py": "1px",
                "textStyle": "md",
              },
            },
          },
        },
        "link": {
          "className": "link",
          "base": {
            "alignItems": "center",
            "color": "fg.default",
            "cursor": "pointer",
            "display": "inline-flex",
            "fontWeight": "medium",
            "gap": "2",
            "textDecoration": "underline 0.1em transparent",
            "textUnderlineOffset": "0.125em",
            "transitionDuration": "normal",
            "transitionProperty": "text-decoration-color",
            "transitionTimingFunction": "default",
            "_hover": {
              "textDecorationColor": "colorPalette.default",
            },
            "& svg": {
              "width": "1em",
              "height": "1em",
            },
          },
        },
        "skeleton": {
          "className": "skeleton",
          "base": {
            "animation": "skeleton-pulse",
            "backgroundClip": "padding-box",
            "backgroundColor": "gray.a4",
            "borderRadius": "l3",
            "color": "transparent",
            "cursor": "default",
            "pointerEvents": "none",
            "userSelect": "none",
            "&::before, &::after, *": {
              "visibility": "hidden",
            },
          },
        },
        "spinner": {
          "className": "spinner",
          "base": {
            "display": "inline-block",
            "borderWidth": "2px",
            "borderColor": "colorPalette.default",
            "borderStyle": "solid",
            "borderRadius": "full",
            "width": "var(--size)",
            "height": "var(--size)",
            "animation": "spin",
            "animationDuration": "slowest",
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "xs": {
                "--size": "sizes.3",
              },
              "sm": {
                "--size": "sizes.4",
              },
              "md": {
                "--size": "sizes.6",
              },
              "lg": {
                "--size": "sizes.8",
              },
              "xl": {
                "--size": "sizes.12",
              },
            },
          },
        },
        "textarea": {
          "className": "textarea",
          "jsx": [
            "Textarea",
            "Field.Textarea",
          ],
          "base": {
            "appearance": "none",
            "background": "none",
            "borderColor": "border.default",
            "borderRadius": "l2",
            "borderWidth": "1px",
            "minWidth": 0,
            "outline": 0,
            "position": "relative",
            "transitionDuration": "normal",
            "transitionProperty": "border-color, box-shadow",
            "width": "full",
            "_disabled": {
              "opacity": 0.4,
              "cursor": "not-allowed",
            },
            "_focus": {
              "borderColor": "colorPalette.default",
              "boxShadow": "0 0 0 1px var(--colors-color-palette-default)",
            },
            "_invalid": {
              "borderColor": "fg.error",
              "_focus": {
                "borderColor": "fg.error",
                "boxShadow": "0 0 0 1px var(--colors-border-error)",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "p": "2.5",
                "fontSize": "sm",
              },
              "md": {
                "p": "3",
                "fontSize": "md",
              },
              "lg": {
                "p": "3.5",
                "fontSize": "md",
              },
              "xl": {
                "p": "4",
                "fontSize": "md",
              },
            },
          },
        },
        "text": {
          "className": "text",
          "jsx": [
            "Heading",
            "Text",
          ],
          "variants": {
            "variant": {
              "heading": {
                "color": "fg.default",
                "fontWeight": "semibold",
              },
            },
            "size": {
              "xs": {
                "textStyle": "xs",
                "lineHeight": "1.125rem",
              },
              "sm": {
                "textStyle": "sm",
                "lineHeight": "1.25rem",
              },
              "md": {
                "textStyle": "md",
                "lineHeight": "1.5rem",
              },
              "lg": {
                "textStyle": "lg",
                "lineHeight": "1.75rem",
              },
              "xl": {
                "textStyle": "xl",
                "lineHeight": "1.875rem",
              },
              "2xl": {
                "textStyle": "2xl",
                "lineHeight": "2rem",
              },
              "3xl": {
                "textStyle": "3xl",
                "lineHeight": "2.375rem",
              },
              "4xl": {
                "textStyle": "4xl",
                "lineHeight": "2.75rem",
                "letterSpacing": "-0.02em",
              },
              "5xl": {
                "textStyle": "5xl",
                "lineHeight": "3.75rem",
                "letterSpacing": "-0.02em",
              },
              "6xl": {
                "textStyle": "6xl",
                "lineHeight": "4.5rem",
                "letterSpacing": "-0.02em",
              },
              "7xl": {
                "textStyle": "7xl",
                "lineHeight": "5.75rem",
                "letterSpacing": "-0.02em",
              },
            },
          },
        },
      },
      "slotRecipes": {
        "accordion": {
          "className": "accordion",
          "slots": [
            "root",
            "item",
            "itemTrigger",
            "itemContent",
            "itemIndicator",
          ],
          "base": {
            "root": {
              "divideY": "1px",
              "width": "full",
              "borderTopWidth": "1px",
              "borderBottomWidth": "1px",
            },
            "itemTrigger": {
              "alignItems": "center",
              "color": "fg.default",
              "cursor": "pointer",
              "display": "flex",
              "fontWeight": "semibold",
              "gap": "3",
              "justifyContent": "space-between",
              "textStyle": "lg",
              "textAlign": "left",
              "width": "full",
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
              },
            },
            "itemIndicator": {
              "color": "fg.muted",
              "transformOrigin": "center",
              "transitionDuration": "normal",
              "transitionProperty": "transform",
              "transitionTimingFunction": "default",
              "_open": {
                "transform": "rotate(-180deg)",
              },
            },
            "itemContent": {
              "color": "fg.muted",
              "overflow": "hidden",
              "transitionProperty": "padding-bottom",
              "transitionDuration": "normal",
              "transitionTimingFunction": "default",
              "_open": {
                "animation": "collapse-in",
              },
              "_closed": {
                "animation": "collapse-out",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "md": {
                "itemTrigger": {
                  "py": "4",
                },
                "itemContent": {
                  "pb": "6",
                  "pr": "8",
                  "_closed": {
                    "pb": "0",
                  },
                },
              },
            },
          },
        },
        "alert": {
          "className": "alert",
          "slots": [
            "root",
            "content",
            "description",
            "icon",
            "title",
          ],
          "base": {
            "root": {
              "background": "bg.default",
              "borderWidth": "1px",
              "borderRadius": "l3",
              "display": "flex",
              "gap": "3",
              "p": "4",
              "width": "full",
            },
            "content": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1",
            },
            "description": {
              "color": "fg.muted",
              "textStyle": "sm",
            },
            "icon": {
              "color": "fg.default",
              "flexShrink": "0",
              "width": "5",
              "height": "5",
            },
            "title": {
              "color": "fg.default",
              "fontWeight": "semibold",
              "textStyle": "sm",
            },
          },
        },
        "avatar": {
          "className": "avatar",
          "slots": [
            "root",
            "image",
            "fallback",
          ],
          "base": {
            "root": {
              "borderRadius": "full",
              "flexShrink": 0,
              "overflow": "hidden",
            },
            "fallback": {
              "alignItems": "center",
              "background": "bg.subtle",
              "borderRadius": "full",
              "borderWidth": "1px",
              "color": "fg.default",
              "display": "flex",
              "fontWeight": "semibold",
              "height": "inherit",
              "justifyContent": "center",
              "_hidden": {
                "display": "none",
              },
            },
            "image": {
              "objectFit": "cover",
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "xs": {
                "root": {
                  "height": "8",
                  "width": "8",
                },
                "image": {
                  "height": "8",
                  "width": "8",
                },
                "fallback": {
                  "textStyle": "xs",
                  "& svg": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "sm": {
                "root": {
                  "height": "9",
                  "width": "9",
                },
                "image": {
                  "height": "9",
                  "width": "9",
                },
                "fallback": {
                  "textStyle": "sm",
                  "& svg": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "md": {
                "root": {
                  "height": "10",
                  "width": "10",
                },
                "image": {
                  "height": "10",
                  "width": "10",
                },
                "fallback": {
                  "textStyle": "md",
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
              "lg": {
                "root": {
                  "height": "11",
                  "width": "11",
                },
                "image": {
                  "height": "11",
                  "width": "11",
                },
                "fallback": {
                  "textStyle": "lg",
                  "& svg": {
                    "width": "6",
                    "height": "6",
                  },
                },
              },
              "xl": {
                "root": {
                  "height": "12",
                  "width": "12",
                },
                "image": {
                  "height": "12",
                  "width": "12",
                },
                "fallback": {
                  "textStyle": "xl",
                  "& svg": {
                    "width": "7",
                    "height": "7",
                  },
                },
              },
              "2xl": {
                "root": {
                  "height": "16",
                  "width": "16",
                },
                "image": {
                  "height": "16",
                  "width": "16",
                },
                "fallback": {
                  "textStyle": "2xl",
                  "& svg": {
                    "width": "8",
                    "height": "8",
                  },
                },
              },
            },
          },
        },
        "card": {
          "className": "card",
          "slots": [
            "root",
            "header",
            "body",
            "footer",
            "title",
            "description",
          ],
          "base": {
            "root": {
              "bg": "bg.default",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "overflow": "hidden",
              "position": "relative",
            },
            "header": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1",
              "p": "6",
            },
            "body": {
              "display": "flex",
              "flex": "1",
              "flexDirection": "column",
              "pb": "6",
              "px": "6",
            },
            "footer": {
              "display": "flex",
              "justifyContent": "flex-end",
              "pb": "6",
              "pt": "2",
              "px": "6",
            },
            "title": {
              "color": "fg.default",
              "textStyle": "lg",
              "fontWeight": "semibold",
            },
            "description": {
              "color": "fg.muted",
              "textStyle": "sm",
            },
          },
        },
        "carousel": {
          "className": "carousel",
          "slots": [
            "root",
            "viewport",
            "itemGroup",
            "item",
            "nextTrigger",
            "prevTrigger",
            "indicatorGroup",
            "indicator",
            "control",
          ],
          "base": {
            "viewport": {
              "overflowX": "hidden",
              "position": "relative",
              "borderRadius": "l2",
            },
            "control": {
              "alignItems": "center",
              "background": {
                "_light": "gray.dark.a12",
                "_dark": "gray.light.a12",
              },
              "borderRadius": "l2",
              "bottom": "4",
              "display": "flex",
              "left": "50%",
              "position": "absolute",
              "transform": "translateX(-50%)",
            },
            "indicatorGroup": {
              "display": "flex",
            },
            "indicator": {
              "borderRadius": "full",
              "background": "gray.6",
              "cursor": "pointer",
              "_current": {
                "background": "colorPalette.default",
              },
              "_focusVisible": {
                "outlineOffset": "2px",
                "outline": "2px solid",
                "outlineColor": "border.outline",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "control": {
                  "gap": "1",
                  "p": "1",
                },
                "indicatorGroup": {
                  "gap": "2",
                },
                "indicator": {
                  "width": "2",
                  "height": "2",
                },
              },
              "md": {
                "control": {
                  "gap": "2",
                  "p": "2.5",
                },
                "indicatorGroup": {
                  "gap": "3",
                },
                "indicator": {
                  "width": "2.5",
                  "height": "2.5",
                },
              },
            },
          },
        },
        "checkbox": {
          "className": "checkbox",
          "slots": [
            "root",
            "label",
            "control",
            "indicator",
            "group",
          ],
          "base": {
            "root": {
              "alignItems": "center",
              "display": "flex",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "control": {
              "alignItems": "center",
              "borderColor": "border.default",
              "borderWidth": "1px",
              "color": "colorPalette.fg",
              "cursor": "pointer",
              "display": "flex",
              "justifyContent": "center",
              "transitionDuration": "normal",
              "transitionProperty": "border-color, background",
              "transitionTimingFunction": "default",
              "_hover": {
                "background": "bg.subtle",
              },
              "_checked": {
                "background": "colorPalette.default",
                "borderColor": "colorPalette.default",
                "_hover": {
                  "background": "colorPalette.default",
                },
              },
              "_indeterminate": {
                "background": "colorPalette.default",
                "borderColor": "colorPalette.default",
                "_hover": {
                  "background": "colorPalette.default",
                },
              },
              "&:has(+ :focus-visible)": {
                "outlineOffset": "2px",
                "outline": "2px solid",
                "outlineColor": "border.outline",
                "_checked": {
                  "outlineColor": "colorPalette.default",
                },
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "root": {
                  "gap": "2",
                },
                "control": {
                  "width": "4",
                  "height": "4",
                  "borderRadius": "l1",
                  "& svg": {
                    "width": "3",
                    "height": "3",
                  },
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "md": {
                "root": {
                  "gap": "3",
                },
                "control": {
                  "width": "5",
                  "height": "5",
                  "borderRadius": "l1",
                  "& svg": {
                    "width": "3.5",
                    "height": "3.5",
                  },
                },
                "label": {
                  "textStyle": "md",
                },
              },
              "lg": {
                "root": {
                  "gap": "4",
                },
                "control": {
                  "width": "6",
                  "height": "6",
                  "borderRadius": "l1",
                  "& svg": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "label": {
                  "textStyle": "lg",
                },
              },
            },
          },
        },
        "clipboard": {
          "className": "clipboard",
          "slots": [
            "root",
            "control",
            "trigger",
            "indicator",
            "input",
            "label",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "control": {
              "display": "flex",
              "gap": "3",
            },
          },
        },
        "collapsible": {
          "className": "collapsible",
          "slots": [
            "root",
            "trigger",
            "content",
          ],
          "base": {
            "root": {
              "alignItems": "flex-start",
              "display": "flex",
              "flexDirection": "column",
              "width": "full",
            },
            "content": {
              "overflow": "hidden",
              "width": "full",
              "_open": {
                "animation": "collapse-in",
              },
              "_closed": {
                "animation": "collapse-out",
              },
            },
          },
        },
        "colorPicker": {
          "className": "colorPicker",
          "slots": [
            "root",
            "label",
            "control",
            "trigger",
            "positioner",
            "content",
            "area",
            "areaThumb",
            "valueText",
            "areaBackground",
            "channelSlider",
            "channelSliderLabel",
            "channelSliderTrack",
            "channelSliderThumb",
            "channelSliderValueText",
            "channelInput",
            "transparencyGrid",
            "swatchGroup",
            "swatchTrigger",
            "swatchIndicator",
            "swatch",
            "eyeDropperTrigger",
            "formatTrigger",
            "formatSelect",
            "view",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
              "textStyle": "sm",
            },
            "control": {
              "display": "flex",
              "flexDirection": "row",
              "gap": "2",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "maxWidth": "sm",
              "p": "4",
              "zIndex": "dropdown",
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
              "_hidden": {
                "display": "none",
              },
            },
            "area": {
              "height": "36",
              "borderRadius": "l2",
              "overflow": "hidden",
            },
            "areaThumb": {
              "borderRadius": "full",
              "height": "2.5",
              "width": "2.5",
              "boxShadow": "white 0px 0px 0px 2px, black 0px 0px 2px 1px",
              "outline": "none",
            },
            "areaBackground": {
              "height": "full",
            },
            "channelSlider": {
              "borderRadius": "l2",
            },
            "channelSliderTrack": {
              "height": "3",
              "borderRadius": "l2",
            },
            "swatchGroup": {
              "display": "grid",
              "gridTemplateColumns": "repeat(7, 1fr)",
              "gap": "2",
              "background": "bg.default",
            },
            "swatch": {
              "height": "6",
              "width": "6",
              "borderRadius": "l2",
              "boxShadow":
                "0 0 0 1px var(--colors-border-emphasized), 0 0 0 2px var(--colors-bg-default) inset",
            },
            "channelSliderThumb": {
              "borderRadius": "full",
              "height": "2.5",
              "width": "2.5",
              "boxShadow": "white 0px 0px 0px 2px, black 0px 0px 2px 1px",
              "transform": "translate(-50%, -50%)",
              "outline": "none",
            },
            "transparencyGrid": {
              "borderRadius": "l2",
            },
          },
        },
        "combobox": {
          "className": "combobox",
          "slots": [
            "root",
            "clearTrigger",
            "content",
            "control",
            "input",
            "item",
            "itemGroup",
            "itemGroupLabel",
            "itemIndicator",
            "itemText",
            "label",
            "list",
            "positioner",
            "trigger",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
              "width": "full",
            },
            "control": {
              "position": "relative",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "trigger": {
              "bottom": "0",
              "color": "fg.muted",
              "position": "absolute",
              "right": "0",
              "top": "0",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l2",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "zIndex": "dropdown",
              "_hidden": {
                "display": "none",
              },
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
              "_focusVisible": {
                "outlineOffset": "2px",
                "outline": "2px solid",
                "outlineColor": "border.outline",
              },
            },
            "item": {
              "alignItems": "center",
              "borderRadius": "l1",
              "cursor": "pointer",
              "display": "flex",
              "justifyContent": "space-between",
              "transitionDuration": "fast",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
              "_hover": {
                "background": "bg.muted",
              },
              "_highlighted": {
                "background": "bg.muted",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "background": "transparent",
                },
              },
            },
            "itemGroupLabel": {
              "fontWeight": "semibold",
              "textStyle": "sm",
            },
            "itemIndicator": {
              "color": "colorPalette.default",
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "content": {
                  "p": "0.5",
                  "gap": "1",
                },
                "item": {
                  "textStyle": "sm",
                  "px": "2",
                  "height": "9",
                },
                "itemIndicator": {
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "itemGroupLabel": {
                  "px": "2",
                  "py": "1.5",
                },
                "label": {
                  "textStyle": "sm",
                },
                "trigger": {
                  "right": "2.5",
                },
              },
              "md": {
                "content": {
                  "p": "1",
                  "gap": "1",
                },
                "item": {
                  "textStyle": "md",
                  "px": "2",
                  "height": "10",
                },
                "itemIndicator": {
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "itemGroupLabel": {
                  "px": "2",
                  "py": "1.5",
                },
                "label": {
                  "textStyle": "sm",
                },
                "trigger": {
                  "right": "3",
                },
              },
              "lg": {
                "content": {
                  "p": "1.5",
                  "gap": "1",
                },
                "item": {
                  "textStyle": "md",
                  "px": "2",
                  "height": "11",
                },
                "itemIndicator": {
                  "& :where(svg)": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "itemGroupLabel": {
                  "px": "2",
                  "py": "1.5",
                },
                "label": {
                  "textStyle": "sm",
                },
                "trigger": {
                  "right": "3.5",
                },
              },
            },
          },
        },
        "datePicker": {
          "className": "datePicker",
          "slots": [
            "root",
            "label",
            "clearTrigger",
            "content",
            "control",
            "input",
            "monthSelect",
            "nextTrigger",
            "positioner",
            "prevTrigger",
            "rangeText",
            "table",
            "tableBody",
            "tableCell",
            "tableCellTrigger",
            "tableHead",
            "tableHeader",
            "tableRow",
            "trigger",
            "viewTrigger",
            "viewControl",
            "yearSelect",
            "presetTrigger",
            "view",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "gap": "3",
              "p": "4",
              "width": "344px",
              "zIndex": "dropdown",
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
              "_hidden": {
                "display": "none",
              },
            },
            "control": {
              "display": "flex",
              "flexDirection": "row",
              "gap": "2",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
              "textStyle": "sm",
            },
            "tableHeader": {
              "color": "fg.muted",
              "fontWeight": "semibold",
              "height": "10",
              "textStyle": "sm",
            },
            "viewControl": {
              "display": "flex",
              "gap": "2",
              "justifyContent": "space-between",
            },
            "table": {
              "width": "full",
              "borderCollapse": "separate",
              "borderSpacing": "1",
              "m": "-1",
            },
            "tableCell": {
              "textAlign": "center",
            },
            "tableCellTrigger": {
              "width": "100%",
              "_today": {
                "_before": {
                  "content": "'−'",
                  "color": "colorPalette.default",
                  "position": "absolute",
                  "marginTop": "6",
                },
              },
              "&[data-in-range]": {
                "background": "bg.muted",
              },
              "_selected": {
                "_before": {
                  "color": "colorPalette.fg",
                },
              },
            },
            "view": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "3",
              "_hidden": {
                "display": "none",
              },
            },
          },
        },
        "dialog": {
          "className": "dialog",
          "slots": [
            "trigger",
            "backdrop",
            "positioner",
            "content",
            "title",
            "description",
            "closeTrigger",
          ],
          "base": {
            "backdrop": {
              "backdropFilter": "blur(4px)",
              "background": {
                "_light": "white.a10",
                "_dark": "black.a10",
              },
              "height": "100vh",
              "left": "0",
              "position": "fixed",
              "top": "0",
              "width": "100vw",
              "zIndex": "overlay",
              "_open": {
                "animation": "backdrop-in",
              },
              "_closed": {
                "animation": "backdrop-out",
              },
            },
            "positioner": {
              "alignItems": "center",
              "display": "flex",
              "justifyContent": "center",
              "left": "0",
              "overflow": "auto",
              "position": "fixed",
              "top": "0",
              "width": "100vw",
              "height": "100dvh",
              "zIndex": "modal",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "minW": "sm",
              "position": "relative",
              "_open": {
                "animation": "dialog-in",
              },
              "_closed": {
                "animation": "dialog-out",
              },
            },
            "title": {
              "fontWeight": "semibold",
              "textStyle": "lg",
            },
            "description": {
              "color": "fg.muted",
              "textStyle": "sm",
            },
          },
        },
        "drawer": {
          "className": "drawer",
          "slots": [
            "trigger",
            "backdrop",
            "positioner",
            "content",
            "title",
            "description",
            "closeTrigger",
            "header",
            "body",
            "footer",
          ],
          "base": {
            "backdrop": {
              "backdropFilter": "blur(4px)",
              "background": {
                "_light": "white.a10",
                "_dark": "black.a10",
              },
              "height": "100vh",
              "left": "0",
              "position": "fixed",
              "top": "0",
              "width": "100vw",
              "zIndex": "overlay",
              "_open": {
                "animation": "backdrop-in",
              },
              "_closed": {
                "animation": "backdrop-out",
              },
            },
            "positioner": {
              "alignItems": "center",
              "display": "flex",
              "height": "100dvh",
              "justifyContent": "center",
              "position": "fixed",
              "top": 0,
              "width": {
                "base": "100vw",
                "sm": "sm",
              },
              "zIndex": "modal",
            },
            "content": {
              "background": "bg.default",
              "boxShadow": "lg",
              "display": "grid",
              "divideY": "1px",
              "gridTemplateColumns": "1fr",
              "gridTemplateRows": "auto 1fr auto",
              "gridTemplateAreas":
                "\n        'header'\n        'body'\n        'footer'\n      ",
              "height": "full",
              "width": "full",
              "_hidden": {
                "display": "none",
              },
            },
            "header": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1",
              "gridArea": "header",
              "pt": {
                "base": "4",
                "md": "6",
              },
              "pb": "4",
              "px": {
                "base": "4",
                "md": "6",
              },
            },
            "body": {
              "display": "flex",
              "flexDirection": "column",
              "gridArea": "body",
              "overflow": "auto",
              "p": {
                "base": "4",
                "md": "6",
              },
            },
            "footer": {
              "display": "flex",
              "gridArea": "footer",
              "justifyContent": "flex-end",
              "py": "4",
              "px": {
                "base": "4",
                "md": "6",
              },
            },
            "title": {
              "color": "fg.default",
              "fontWeight": "semibold",
              "textStyle": "xl",
            },
            "description": {
              "color": "fg.muted",
              "textStyle": "sm",
            },
          },
          "defaultVariants": {
            "variant": "right",
          },
          "variants": {
            "variant": {
              "left": {
                "positioner": {
                  "left": 0,
                },
                "content": {
                  "_open": {
                    "animation": "drawer-in-left",
                  },
                  "_closed": {
                    "animation": "drawer-out-left",
                  },
                },
              },
              "right": {
                "positioner": {
                  "right": 0,
                },
                "content": {
                  "_open": {
                    "animation": "drawer-in-right",
                  },
                  "_closed": {
                    "animation": "drawer-out-right",
                  },
                },
              },
            },
          },
        },
        "editable": {
          "className": "editable",
          "slots": [
            "root",
            "area",
            "label",
            "preview",
            "input",
            "editTrigger",
            "submitTrigger",
            "cancelTrigger",
            "control",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
              "width": "100%",
            },
            "control": {
              "display": "flex",
              "gap": "2",
            },
          },
        },
        "field": {
          "className": "field",
          "slots": [
            "root",
            "errorText",
            "helperText",
            "input",
            "label",
            "select",
            "textarea",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
              "textStyle": "sm",
              "_disabled": {
                "color": "fg.disabled",
              },
            },
            "helperText": {
              "color": "fg.muted",
              "textStyle": "sm",
              "_disabled": {
                "color": "fg.disabled",
              },
            },
            "errorText": {
              "alignItems": "center",
              "color": "fg.error",
              "display": "inline-flex",
              "gap": "2",
              "textStyle": "sm",
              "_disabled": {
                "color": "fg.disabled",
              },
            },
          },
        },
        "fieldset": {
          "className": "fieldset",
          "slots": [
            "root",
            "errorText",
            "helperText",
            "legend",
            "control",
          ],
          "base": {
            "root": {
              "display": "grid",
              "borderTopWidth": "1px",
              "py": "6",
              "columnGap": "8",
              "rowGap": "1.5",
              "gridTemplateAreas": {
                "base":
                  '\n        "legend legend" \n        "helperText helperText"\n        "control control"\n        "errorText errorText"\n        ',
                "md":
                  '\n        "legend control"\n        "helperText control"\n        "errorText errorText"',
              },
              "gridTemplateRows": "auto 1fr",
              "gridTemplateColumns": "1fr auto",
              "width": "full",
            },
            "control": {
              "gridArea": "control",
              "display": "grid",
              "gap": "4",
            },
            "legend": {
              "color": "fg.default",
              "fontWeight": "medium",
              "gridArea": "legend",
              "textStyle": "sm",
              "float": "left",
              "+ *": {
                "clear": "both",
              },
              "_disabled": {
                "color": "fg.disabled",
              },
            },
            "helperText": {
              "color": "fg.muted",
              "gridArea": "helperText",
              "textStyle": "sm",
              "_disabled": {
                "color": "fg.disabled",
              },
            },
            "errorText": {
              "alignItems": "center",
              "color": "fg.error",
              "display": "inline-flex",
              "gap": "2",
              "gridArea": "errorText",
              "mt": "4",
              "textStyle": "sm",
              "_disabled": {
                "color": "fg.disabled",
              },
            },
          },
        },
        "fileUpload": {
          "className": "fileUpload",
          "slots": [
            "root",
            "dropzone",
            "item",
            "itemDeleteTrigger",
            "itemGroup",
            "itemName",
            "itemPreview",
            "itemPreviewImage",
            "itemSizeText",
            "label",
            "trigger",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "4",
              "width": "100%",
            },
            "label": {
              "fontWeight": "medium",
              "textStyle": "sm",
            },
            "dropzone": {
              "alignItems": "center",
              "background": "bg.default",
              "borderRadius": "l3",
              "borderWidth": "1px",
              "display": "flex",
              "flexDirection": "column",
              "gap": "3",
              "justifyContent": "center",
              "minHeight": "xs",
              "px": "6",
              "py": "4",
            },
            "item": {
              "animation": "fadeIn 0.25s ease-out",
              "background": "bg.default",
              "borderRadius": "l3",
              "borderWidth": "1px",
              "columnGap": "3",
              "display": "grid",
              "gridTemplateColumns": "auto 1fr auto",
              "gridTemplateAreas":
                '\n        "preview name delete"\n        "preview size delete"\n        ',
              "p": "4",
            },
            "itemGroup": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "3",
            },
            "itemName": {
              "color": "fg.default",
              "fontWeight": "medium",
              "gridArea": "name",
              "textStyle": "sm",
            },
            "itemSizeText": {
              "color": "fg.muted",
              "gridArea": "size",
              "textStyle": "sm",
            },
            "itemDeleteTrigger": {
              "alignSelf": "flex-start",
              "gridArea": "delete",
            },
            "itemPreview": {
              "gridArea": "preview",
            },
            "itemPreviewImage": {
              "aspectRatio": "1",
              "height": "10",
              "objectFit": "scale-down",
              "width": "10",
            },
          },
        },
        "hoverCard": {
          "className": "hoverCard",
          "slots": [
            "arrow",
            "arrowTip",
            "trigger",
            "positioner",
            "content",
          ],
          "base": {
            "content": {
              "--hover-card-background": "colors.bg.default",
              "background": "var(--hover-card-background)",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "maxW": "80",
              "p": "4",
              "position": "relative",
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
            },
            "arrow": {
              "--arrow-size": "12px",
              "--arrow-background": "var(--hover-card-background)",
            },
            "arrowTip": {
              "borderTopWidth": "1px",
              "borderLeftWidth": "1px",
            },
          },
        },
        "menu": {
          "className": "menu",
          "slots": [
            "arrow",
            "arrowTip",
            "content",
            "contextTrigger",
            "indicator",
            "item",
            "itemGroup",
            "itemGroupLabel",
            "itemIndicator",
            "itemText",
            "positioner",
            "separator",
            "trigger",
            "triggerItem",
          ],
          "base": {
            "itemGroupLabel": {
              "fontWeight": "semibold",
              "textStyle": "sm",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l2",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "outline": "none",
              "width": "calc(100% + 2rem)",
              "zIndex": "dropdown",
              "_hidden": {
                "display": "none",
              },
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
            },
            "itemGroup": {
              "display": "flex",
              "flexDirection": "column",
            },
            "positioner": {
              "zIndex": "dropdown",
            },
            "item": {
              "alignItems": "center",
              "borderRadius": "l1",
              "cursor": "pointer",
              "display": "flex",
              "fontWeight": "medium",
              "textStyle": "sm",
              "transitionDuration": "fast",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
              "_hover": {
                "background": "bg.muted",
                "& :where(svg)": {
                  "color": "fg.default",
                },
              },
              "_highlighted": {
                "background": "bg.muted",
              },
              "& :where(svg)": {
                "color": "fg.muted",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "color": "fg.disabled",
                  "background": "none",
                },
              },
            },
            "triggerItem": {
              "alignItems": "center",
              "borderRadius": "l1",
              "cursor": "pointer",
              "display": "flex",
              "fontWeight": "medium",
              "textStyle": "sm",
              "transitionDuration": "fast",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
              "_hover": {
                "background": "bg.muted",
                "& :where(svg)": {
                  "color": "fg.default",
                },
              },
              "_highlighted": {
                "background": "bg.muted",
              },
              "& :where(svg)": {
                "color": "fg.muted",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "color": "fg.disabled",
                  "background": "none",
                },
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "xs": {
                "itemGroup": {
                  "gap": "1",
                },
                "itemGroupLabel": {
                  "py": "1.5",
                  "px": "1.5",
                  "mx": "1",
                },
                "content": {
                  "py": "1",
                  "gap": "1",
                },
                "item": {
                  "h": "8",
                  "px": "1.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "optionItem": {
                  "h": "8",
                  "px": "1.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "triggerItem": {
                  "h": "8",
                  "px": "1.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "sm": {
                "itemGroup": {
                  "gap": "1",
                },
                "itemGroupLabel": {
                  "py": "2",
                  "px": "2",
                  "mx": "1",
                },
                "content": {
                  "py": "1",
                  "gap": "1",
                },
                "item": {
                  "h": "9",
                  "px": "2",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "optionItem": {
                  "h": "9",
                  "px": "2",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "triggerItem": {
                  "h": "9",
                  "px": "2",
                  "mx": "1.5",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "md": {
                "itemGroup": {
                  "gap": "1",
                },
                "itemGroupLabel": {
                  "py": "2.5",
                  "px": "2.5",
                  "mx": "1",
                },
                "content": {
                  "py": "1",
                  "gap": "1",
                },
                "item": {
                  "h": "10",
                  "px": "2.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "optionItem": {
                  "h": "10",
                  "px": "2.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "triggerItem": {
                  "h": "10",
                  "px": "2.5",
                  "mx": "1.5",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "lg": {
                "itemGroup": {
                  "gap": "1",
                },
                "itemGroupLabel": {
                  "py": "2.5",
                  "px": "2.5",
                  "mx": "1",
                },
                "content": {
                  "py": "1",
                  "gap": "1",
                },
                "item": {
                  "h": "11",
                  "px": "2.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "optionItem": {
                  "h": "11",
                  "px": "2.5",
                  "mx": "1",
                  "& :where(svg)": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "triggerItem": {
                  "h": "11",
                  "px": "2.5",
                  "mx": "1.5",
                  "& :where(svg)": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
            },
          },
        },
        "numberInput": {
          "className": "numberInput",
          "slots": [
            "root",
            "label",
            "input",
            "control",
            "valueText",
            "incrementTrigger",
            "decrementTrigger",
            "scrubber",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "control": {
              "borderColor": "border.default",
              "borderRadius": "l2",
              "borderWidth": "1px",
              "display": "grid",
              "divideX": "1px",
              "gridTemplateColumns": "1fr 32px",
              "gridTemplateRows": "1fr 1fr",
              "overflow": "hidden",
              "transitionDuration": "normal",
              "transitionProperty": "border-color, box-shadow",
              "transitionTimingFunction": "default",
              "_focusWithin": {
                "borderColor": "colorPalette.default",
                "boxShadow": "0 0 0 1px var(--colors-color-palette-default)",
              },
              "_disabled": {
                "opacity": 0.4,
                "cursor": "not-allowed",
              },
            },
            "input": {
              "background": "transparent",
              "border": "none",
              "gridRow": "span 2 / span 2",
              "outline": "none",
              "width": "full",
              "_disabled": {
                "cursor": "not-allowed",
              },
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "decrementTrigger": {
              "alignItems": "center",
              "borderColor": "border.default",
              "color": "fg.muted",
              "cursor": "pointer",
              "display": "inline-flex",
              "justifyContent": "center",
              "transitionDuration": "normal",
              "transitionProperty":
                "background, border-color, color, box-shadow",
              "transitionTimingFunction": "default",
              "& :where(svg)": {
                "width": "4",
                "height": "4",
              },
              "_hover": {
                "background": "gray.a2",
                "color": "fg.default",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "background": "transparent",
                  "color": "fg.disabled",
                },
              },
              "borderTopWidth": "1px",
            },
            "incrementTrigger": {
              "alignItems": "center",
              "borderColor": "border.default",
              "color": "fg.muted",
              "cursor": "pointer",
              "display": "inline-flex",
              "justifyContent": "center",
              "transitionDuration": "normal",
              "transitionProperty":
                "background, border-color, color, box-shadow",
              "transitionTimingFunction": "default",
              "& :where(svg)": {
                "width": "4",
                "height": "4",
              },
              "_hover": {
                "background": "gray.a2",
                "color": "fg.default",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "background": "transparent",
                  "color": "fg.disabled",
                },
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "md": {
                "control": {
                  "ps": "3",
                  "h": "10",
                  "minW": "10",
                  "fontSize": "md",
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "lg": {
                "control": {
                  "ps": "3.5",
                  "h": "11",
                  "minW": "11",
                  "fontSize": "md",
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "xl": {
                "control": {
                  "ps": "4",
                  "h": "12",
                  "minW": "12",
                  "fontSize": "lg",
                },
                "label": {
                  "textStyle": "md",
                },
              },
            },
          },
        },
        "pagination": {
          "className": "pagination",
          "slots": [
            "root",
            "item",
            "ellipsis",
            "prevTrigger",
            "nextTrigger",
          ],
          "base": {
            "root": {
              "display": "flex",
              "gap": "2.5",
            },
            "item": {
              "fontVariantNumeric": "tabular-nums",
            },
            "ellipsis": {
              "alignItems": "center",
              "color": "fg.default",
              "display": "inline-flex",
              "fontWeight": "semibold",
              "px": "2",
            },
          },
        },
        "pinInput": {
          "className": "pinInput",
          "slots": [
            "root",
            "label",
            "input",
            "control",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "control": {
              "display": "flex",
              "gap": "2",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "input": {
              "px": "0!",
              "textAlign": "center",
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "xs": {
                "label": {
                  "textStyle": "sm",
                },
                "input": {
                  "width": "8",
                },
              },
              "sm": {
                "label": {
                  "textStyle": "sm",
                },
                "input": {
                  "width": "9",
                },
              },
              "md": {
                "label": {
                  "textStyle": "sm",
                },
                "input": {
                  "width": "10",
                },
              },
              "lg": {
                "label": {
                  "textStyle": "sm",
                },
                "input": {
                  "width": "11",
                },
              },
              "xl": {
                "label": {
                  "textStyle": "md",
                },
                "input": {
                  "width": "12",
                },
              },
              "2xl": {
                "label": {
                  "textStyle": "md",
                },
                "input": {
                  "width": "16",
                },
              },
            },
          },
        },
        "popover": {
          "className": "popover",
          "slots": [
            "arrow",
            "arrowTip",
            "anchor",
            "trigger",
            "indicator",
            "positioner",
            "content",
            "title",
            "description",
            "closeTrigger",
          ],
          "base": {
            "positioner": {
              "position": "relative",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "maxWidth": "sm",
              "zIndex": "popover",
              "p": "4",
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
              "_hidden": {
                "display": "none",
              },
            },
            "title": {
              "fontWeight": "medium",
              "textStyle": "sm",
            },
            "description": {
              "color": "fg.muted",
              "textStyle": "sm",
            },
            "closeTrigger": {
              "color": "fg.muted",
            },
            "arrow": {
              "--arrow-size": "var(--sizes-3)",
              "--arrow-background": "var(--colors-bg-default)",
            },
            "arrowTip": {
              "borderTopWidth": "1px",
              "borderLeftWidth": "1px",
            },
          },
        },
        "progress": {
          "className": "progress",
          "slots": [
            "root",
            "label",
            "track",
            "range",
            "valueText",
            "view",
            "circle",
            "circleTrack",
            "circleRange",
          ],
          "base": {
            "root": {
              "alignItems": "center",
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
              "width": "full",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
              "textStyle": "sm",
            },
            "track": {
              "backgroundColor": "bg.emphasized",
              "borderRadius": "l2",
              "overflow": "hidden",
              "width": "100%",
            },
            "range": {
              "backgroundColor": "colorPalette.default",
              "height": "100%",
              "transition": "width 0.2s ease-in-out",
              "--translate-x": "-100%",
            },
            "circleTrack": {
              "stroke": "bg.emphasized",
            },
            "circleRange": {
              "stroke": "colorPalette.default",
              "transitionProperty": "stroke-dasharray, stroke",
              "transitionDuration": "0.6s",
            },
            "valueText": {
              "textStyle": "sm",
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "circle": {
                  "--size": "36px",
                  "--thickness": "4px",
                },
                "track": {
                  "height": "1.5",
                },
              },
              "md": {
                "track": {
                  "height": "2",
                },
                "circle": {
                  "--size": "40px",
                  "--thickness": "4px",
                },
              },
              "lg": {
                "track": {
                  "height": "2.5",
                },
                "circle": {
                  "--size": "44px",
                  "--thickness": "4px",
                },
              },
            },
          },
        },
        "radioButtonGroup": {
          "className": "radioButtonGroup",
          "slots": [
            "root",
            "label",
            "item",
            "itemText",
            "itemControl",
            "indicator",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexWrap": "wrap",
            },
            "item": {
              "alignItems": "center",
              "appearance": "none",
              "borderColor": "border.default",
              "borderRadius": "l2",
              "borderWidth": "1px",
              "color": "fg.default",
              "cursor": "pointer",
              "display": "inline-flex",
              "fontWeight": "semibold",
              "justifyContent": "center",
              "outline": "none",
              "position": "relative",
              "transitionDuration": "normal",
              "transitionProperty":
                "background, border-color, color, box-shadow",
              "transitionTimingFunction": "default",
              "userSelect": "none",
              "verticalAlign": "middle",
              "whiteSpace": "nowrap",
              "_hover": {
                "background": "gray.a2",
              },
              "_checked": {
                "cursor": "default",
              },
              "_disabled": {
                "borderColor": "border.disabled",
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "background": "initial",
                  "borderColor": "border.disabled",
                  "color": "fg.disabled",
                },
              },
            },
            "itemText": {
              "display": "inline-flex",
              "alignItems": "center",
            },
          },
          "defaultVariants": {
            "size": "md",
            "variant": "solid",
          },
          "variants": {
            "variant": {
              "solid": {
                "item": {
                  "_checked": {
                    "background": "colorPalette.default",
                    "borderColor": "colorPalette.default",
                    "color": "colorPalette.fg",
                    "_hover": {
                      "color": "colorPalette.fg",
                      "background": "colorPalette.default",
                    },
                  },
                },
              },
              "outline": {
                "item": {
                  "_checked": {
                    "borderColor": "colorPalette.default",
                    "boxShadow":
                      "0 0 0 1px var(--colors-color-palette-default)",
                    "_hover": {
                      "background": "initial",
                    },
                  },
                },
              },
            },
            "size": {
              "sm": {
                "root": {
                  "gap": "2",
                },
                "item": {
                  "h": "9",
                  "minW": "9",
                  "textStyle": "sm",
                  "px": "3.5",
                  "& svg": {
                    "width": "4.5",
                    "height": "4.5",
                  },
                },
                "itemText": {
                  "gap": "2",
                },
              },
              "md": {
                "root": {
                  "gap": "3",
                },
                "item": {
                  "h": "10",
                  "minW": "10",
                  "textStyle": "sm",
                  "px": "4",
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "itemText": {
                  "gap": "2",
                },
              },
              "lg": {
                "root": {
                  "gap": "3",
                },
                "item": {
                  "h": "11",
                  "minW": "11",
                  "textStyle": "md",
                  "px": "4.5",
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "itemText": {
                  "gap": "2",
                },
              },
              "xl": {
                "root": {
                  "gap": "3",
                },
                "item": {
                  "h": "12",
                  "minW": "12",
                  "textStyle": "md",
                  "px": "5",
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "itemText": {
                  "gap": "2.5",
                },
              },
            },
          },
        },
        "radioGroup": {
          "className": "radioGroup",
          "slots": [
            "root",
            "label",
            "item",
            "itemText",
            "itemControl",
            "indicator",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": {
                "_vertical": "column",
                "_horizontal": "row",
              },
            },
            "itemControl": {
              "background": "transparent",
              "borderColor": "border.default",
              "borderRadius": "full",
              "borderWidth": "1px",
              "transitionDuration": "normal",
              "transitionProperty": "background",
              "transitionTimingFunction": "default",
              "_hover": {
                "background": "bg.subtle",
              },
              "_checked": {
                "background": "colorPalette.default",
                "borderColor": "colorPalette.default",
                "outlineColor": "bg.default",
                "outlineStyle": "solid",
                "_hover": {
                  "background": "colorPalette.default",
                },
              },
              "_disabled": {
                "borderColor": "border.disabled",
                "color": "fg.disabled",
                "_hover": {
                  "bg": "initial",
                  "color": "fg.disabled",
                },
              },
            },
            "item": {
              "alignItems": "center",
              "cursor": "pointer",
              "display": "flex",
              "_disabled": {
                "cursor": "not-allowed",
              },
            },
            "itemText": {
              "color": "fg.default",
              "fontWeight": "medium",
              "_disabled": {
                "color": "fg.disabled",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "root": {
                  "gap": {
                    "_vertical": "3",
                    "_horizontal": "4",
                  },
                },
                "item": {
                  "gap": "2",
                },
                "itemControl": {
                  "width": "4",
                  "height": "4",
                  "_checked": {
                    "outlineWidth": "3px",
                    "outlineOffset": "-4px",
                  },
                },
                "itemText": {
                  "textStyle": "sm",
                },
              },
              "md": {
                "root": {
                  "gap": {
                    "_vertical": "4",
                    "_horizontal": "6",
                  },
                },
                "item": {
                  "gap": "3",
                },
                "itemControl": {
                  "width": "5",
                  "height": "5",
                  "_checked": {
                    "outlineWidth": "4px",
                    "outlineOffset": "-5px",
                  },
                },
                "itemText": {
                  "textStyle": "md",
                },
              },
              "lg": {
                "root": {
                  "gap": {
                    "_vertical": "5",
                    "_horizontal": "8",
                  },
                },
                "item": {
                  "gap": "4",
                },
                "itemControl": {
                  "width": "6",
                  "height": "6",
                  "_checked": {
                    "outlineWidth": "5px",
                    "outlineOffset": "-6px",
                  },
                },
                "itemText": {
                  "textStyle": "lg",
                },
              },
            },
          },
        },
        "ratingGroup": {
          "className": "ratingGroup",
          "slots": [
            "root",
            "label",
            "item",
            "control",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "control": {
              "display": "flex",
            },
            "item": {
              "cursor": "pointer",
              "transitionDuration": "normal",
              "transitionProperty": "color, fill",
              "transitionTimingFunction": "default",
              "fill": "bg.emphasized",
              "_highlighted": {
                "fill": "colorPalette.default",
              },
              "_focusVisible": {
                "outline": "none",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "control": {
                  "gap": "0",
                },
                "item": {
                  "& svg": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "md": {
                "control": {
                  "gap": "0.5",
                },
                "item": {
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "lg": {
                "control": {
                  "gap": "0.5",
                },
                "item": {
                  "& svg": {
                    "width": "6",
                    "height": "6",
                  },
                },
                "label": {
                  "textStyle": "md",
                },
              },
            },
          },
        },
        "segmentGroup": {
          "className": "segmentGroup",
          "slots": [
            "root",
            "label",
            "item",
            "itemText",
            "itemControl",
            "indicator",
          ],
          "base": {
            "root": {
              "alignItems": "flex-start",
              "display": "flex",
              "flexDirection": {
                "_horizontal": "row",
                "_vertical": "column",
              },
              "gap": {
                "_horizontal": "4",
                "_vertical": "1",
              },
              "borderBottomWidth": {
                "_horizontal": "1px",
              },
              "borderLeftWidth": {
                "_vertical": "1px",
              },
            },
            "indicator": {
              "borderColor": "colorPalette.default",
              "_horizontal": {
                "bottom": "0",
                "borderBottomWidth": "2px",
                "transform": "translateY(1px)",
                "width": "var(--width)",
              },
              "_vertical": {
                "borderLeftWidth": "2px",
                "height": "var(--height)",
                "transform": "translateX(-1px)",
              },
            },
            "item": {
              "color": "fg.muted",
              "cursor": "pointer",
              "fontWeight": "medium",
              "transitionDuration": "normal",
              "transitionProperty": "color",
              "transitionTimingFunction": "default",
              "_hover": {
                "color": "fg.default",
              },
              "_checked": {
                "fontWeight": "semibold",
                "color": "fg.default",
                "_hover": {
                  "color": "fg.default",
                },
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "color": "fg.disabled",
                },
              },
              "px": {
                "_horizontal": "1",
                "_vertical": "3",
              },
              "pb": {
                "_horizontal": "3",
              },
              "py": {
                "_vertical": "1.5",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "item": {
                  "textStyle": "sm",
                },
              },
              "md": {
                "item": {
                  "textStyle": "md",
                },
              },
            },
          },
        },
        "select": {
          "className": "select",
          "slots": [
            "label",
            "positioner",
            "trigger",
            "indicator",
            "clearTrigger",
            "item",
            "itemText",
            "itemIndicator",
            "itemGroup",
            "itemGroupLabel",
            "list",
            "content",
            "root",
            "control",
            "valueText",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
              "width": "full",
            },
            "content": {
              "background": "bg.default",
              "borderRadius": "l2",
              "boxShadow": "lg",
              "display": "flex",
              "flexDirection": "column",
              "zIndex": "dropdown",
              "_hidden": {
                "display": "none",
              },
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
              "_focusVisible": {
                "outlineOffset": "2px",
                "outline": "2px solid",
                "outlineColor": "border.outline",
              },
            },
            "item": {
              "alignItems": "center",
              "borderRadius": "l1",
              "cursor": "pointer",
              "display": "flex",
              "justifyContent": "space-between",
              "transitionDuration": "fast",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
              "_hover": {
                "background": "gray.a3",
                "color": "fg.default",
              },
              "_highlighted": {
                "background": "gray.a3",
                "color": "fg.default",
              },
              "_selected": {
                "color": "fg.default",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "background": "transparent",
                  "color": "fg.disabled",
                },
              },
            },
            "itemGroupLabel": {
              "fontWeight": "semibold",
              "textStyle": "sm",
            },
            "itemIndicator": {
              "color": "colorPalette.default",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "trigger": {
              "appearance": "none",
              "alignItems": "center",
              "borderColor": "border.default",
              "borderRadius": "l2",
              "cursor": "pointer",
              "color": "fg.default",
              "display": "inline-flex",
              "justifyContent": "space-between",
              "outline": 0,
              "position": "relative",
              "transitionDuration": "normal",
              "transitionProperty": "background, box-shadow, border-color",
              "transitionTimingFunction": "default",
              "width": "full",
              "_placeholderShown": {
                "color": "fg.subtle",
              },
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "& :where(svg)": {
                  "color": "fg.disabled",
                },
              },
              "& :where(svg)": {
                "color": "fg.subtle",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
            "variant": "outline",
          },
          "variants": {
            "variant": {
              "outline": {
                "trigger": {
                  "borderWidth": "1px",
                  "_focus": {
                    "borderColor": "colorPalette.default",
                    "boxShadow":
                      "0 0 0 1px var(--colors-color-palette-default)",
                  },
                },
              },
              "ghost": {
                "trigger": {
                  "_hover": {
                    "background": "gray.a3",
                  },
                  "_focus": {
                    "background": "gray.a3",
                  },
                },
              },
            },
            "size": {
              "sm": {
                "content": {
                  "p": "0.5",
                  "gap": "1",
                },
                "item": {
                  "textStyle": "sm",
                  "px": "2",
                  "height": "9",
                },
                "itemIndicator": {
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "itemGroupLabel": {
                  "px": "2",
                  "py": "1.5",
                },
                "label": {
                  "textStyle": "sm",
                },
                "trigger": {
                  "px": "2.5",
                  "h": "9",
                  "minW": "9",
                  "fontSize": "sm",
                  "gap": "2",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "md": {
                "content": {
                  "p": "1",
                  "gap": "1",
                },
                "item": {
                  "textStyle": "md",
                  "px": "2",
                  "height": "10",
                },
                "itemIndicator": {
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
                "itemGroupLabel": {
                  "px": "2",
                  "py": "1.5",
                },
                "label": {
                  "textStyle": "sm",
                },
                "trigger": {
                  "px": "3",
                  "h": "10",
                  "minW": "10",
                  "fontSize": "md",
                  "gap": "2",
                  "& :where(svg)": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "lg": {
                "content": {
                  "p": "1.5",
                  "gap": "1",
                },
                "item": {
                  "textStyle": "md",
                  "px": "2",
                  "height": "11",
                },
                "itemIndicator": {
                  "& :where(svg)": {
                    "width": "5",
                    "height": "5",
                  },
                },
                "itemGroupLabel": {
                  "px": "2",
                  "py": "1.5",
                },
                "label": {
                  "textStyle": "sm",
                },
                "trigger": {
                  "px": "3.5",
                  "h": "11",
                  "minW": "11",
                  "fontSize": "md",
                  "gap": "2",
                  "& :where(svg)": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
            },
          },
        },
        "signaturePad": {
          "className": "signaturePad",
          "slots": [
            "root",
            "control",
            "segment",
            "segmentPath",
            "guide",
            "clearTrigger",
            "label",
          ],
          "base": {},
        },
        "slider": {
          "className": "slider",
          "slots": [
            "root",
            "label",
            "thumb",
            "valueText",
            "track",
            "range",
            "control",
            "markerGroup",
            "marker",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1",
              "width": "full",
            },
            "control": {
              "position": "relative",
              "display": "flex",
              "alignItems": "center",
            },
            "track": {
              "backgroundColor": "bg.emphasized",
              "borderRadius": "full",
              "overflow": "hidden",
              "flex": "1",
            },
            "range": {
              "background": "colorPalette.default",
            },
            "thumb": {
              "background": "bg.default",
              "borderColor": "colorPalette.default",
              "borderRadius": "full",
              "borderWidth": "2px",
              "boxShadow": "sm",
              "outline": "none",
              "zIndex": "1",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "markerGroup": {
              "mt": "-1",
            },
            "marker": {
              "--before-background": {
                "_light": "white",
                "_dark": "colors.colorPalette.fg",
              },
              "color": "fg.muted",
              "_before": {
                "background": "white",
                "borderRadius": "full",
                "content": "''",
                "display": "block",
                "left": "50%",
                "position": "relative",
                "transform": "translateX(-50%)",
              },
              "_underValue": {
                "_before": {
                  "background": "var(--before-background)",
                },
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "control": {
                  "height": "4",
                },
                "range": {
                  "height": "1.5",
                },
                "track": {
                  "height": "1.5",
                },
                "thumb": {
                  "height": "4",
                  "width": "4",
                },
                "marker": {
                  "_before": {
                    "height": "1",
                    "top": "-2.5",
                    "width": "1",
                  },
                  "textStyle": "sm",
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "md": {
                "control": {
                  "height": "5",
                },
                "range": {
                  "height": "2",
                },
                "track": {
                  "height": "2",
                },
                "thumb": {
                  "height": "5",
                  "width": "5",
                },
                "marker": {
                  "_before": {
                    "height": "1",
                    "top": "-3",
                    "width": "1",
                  },
                  "textStyle": "sm",
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "lg": {
                "control": {
                  "height": "6",
                },
                "range": {
                  "height": "2.5",
                },
                "track": {
                  "height": "2.5",
                },
                "thumb": {
                  "height": "6",
                  "width": "6",
                },
                "marker": {
                  "_before": {
                    "height": "1.5",
                    "top": "-15px",
                    "width": "1.5",
                  },
                  "textStyle": "md",
                },
                "label": {
                  "textStyle": "md",
                },
              },
            },
          },
        },
        "splitter": {
          "className": "splitter",
          "slots": [
            "root",
            "panel",
            "resizeTrigger",
          ],
          "base": {
            "root": {
              "display": "flex",
              "gap": "2",
            },
            "panel": {
              "borderWidth": "1px",
              "background": "bg.default",
              "borderRadius": "l2",
              "color": "fg.muted",
              "display": "flex",
              "alignItems": "center",
              "justifyContent": "center",
            },
            "resizeTrigger": {
              "borderRadius": "full",
              "transitionDuration": "normal",
              "transitionProperty": "background",
              "transitionTimingFunction": "default",
              "outline": "0",
              "background": "gray.7",
              "_hover": {
                "background": "gray.8",
              },
              "_active": {
                "background": "gray.8",
              },
              "_horizontal": {
                "minWidth": "1.5",
                "margin": "min(1rem, 20%) 0",
              },
              "_vertical": {
                "minHeight": "1.5",
                "margin": "0 min(1rem, 20%)",
              },
            },
          },
        },
        "switchRecipe": {
          "className": "switchRecipe",
          "jsx": [
            "Switch",
            /Switch\.+/,
          ],
          "slots": [
            "root",
            "label",
            "control",
            "thumb",
          ],
          "base": {
            "root": {
              "alignItems": "center",
              "display": "flex",
              "position": "relative",
            },
            "control": {
              "alignItems": "center",
              "background": "bg.emphasized",
              "borderRadius": "full",
              "cursor": "pointer",
              "display": "inline-flex",
              "flexShrink": "0",
              "transitionDuration": "normal",
              "transitionProperty": "background",
              "transitionTimingFunction": "default",
              "_checked": {
                "background": "colorPalette.default",
              },
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
            },
            "thumb": {
              "background": "bg.default",
              "borderRadius": "full",
              "boxShadow": "xs",
              "transitionDuration": "normal",
              "transitionProperty": "transform, background",
              "transitionTimingFunction": "default",
              "_checked": {
                "transform": "translateX(100%)",
                "background": {
                  "_light": "bg.default",
                  "_dark": "colorPalette.fg",
                },
              },
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "sm": {
                "root": {
                  "gap": "2",
                },
                "control": {
                  "width": "7",
                  "p": "0.5",
                },
                "thumb": {
                  "width": "3",
                  "height": "3",
                },
                "label": {
                  "textStyle": "sm",
                },
              },
              "md": {
                "root": {
                  "gap": "3",
                },
                "control": {
                  "width": "9",
                  "p": "0.5",
                },
                "thumb": {
                  "width": "4",
                  "height": "4",
                },
                "label": {
                  "textStyle": "md",
                },
              },
              "lg": {
                "root": {
                  "gap": "4",
                },
                "control": {
                  "width": "11",
                  "p": "0.5",
                },
                "thumb": {
                  "width": "5",
                  "height": "5",
                },
                "label": {
                  "textStyle": "lg",
                },
              },
            },
          },
        },
        "table": {
          "className": "table",
          "slots": [
            "root",
            "body",
            "cell",
            "footer",
            "head",
            "header",
            "row",
            "caption",
          ],
          "base": {
            "root": {
              "captionSide": "bottom",
              "width": "full",
            },
            "body": {
              "& tr:last-child": {
                "borderBottomWidth": "0",
              },
            },
            "caption": {
              "color": "fg.subtle",
            },
            "cell": {
              "verticalAlign": "middle",
            },
            "footer": {
              "fontWeight": "medium",
              "borderTopWidth": "1px",
              "& tr:last-child": {
                "borderBottomWidth": "0",
              },
            },
            "header": {
              "color": "fg.muted",
              "fontWeight": "medium",
              "textAlign": "left",
              "verticalAlign": "middle",
            },
            "row": {
              "borderBottomWidth": "1px",
              "transitionDuration": "normal",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
            },
          },
          "defaultVariants": {
            "size": "md",
            "variant": "plain",
          },
          "variants": {
            "variant": {
              "outline": {
                "root": {
                  "borderWidth": "1px",
                },
                "head": {
                  "bg": "bg.subtle",
                },
              },
              "plain": {
                "row": {
                  "_hover": {
                    "bg": "bg.subtle",
                  },
                  "_selected": {
                    "bg": "bg.muted",
                  },
                },
              },
            },
            "size": {
              "sm": {
                "root": {
                  "textStyle": "sm",
                },
                "caption": {
                  "mt": "4",
                },
                "cell": {
                  "height": "11",
                  "px": "3",
                },
                "header": {
                  "height": "11",
                  "px": "3",
                },
              },
              "md": {
                "root": {
                  "textStyle": "sm",
                },
                "caption": {
                  "mt": "4",
                },
                "cell": {
                  "height": "14",
                  "px": "4",
                },
                "header": {
                  "height": "11",
                  "px": "4",
                },
              },
            },
          },
        },
        "tabs": {
          "className": "tabs",
          "slots": [
            "root",
            "list",
            "trigger",
            "content",
            "indicator",
          ],
          "base": {
            "root": {
              "display": "flex",
              "width": "full",
              "_horizontal": {
                "flexDirection": "column",
              },
              "_vertical": {
                "flexDirection": "row",
              },
            },
            "list": {
              "display": "flex",
              "flexShrink": "0",
              "_horizontal": {
                "flexDirection": "row",
              },
              "_vertical": {
                "flexDirection": "column",
              },
              "overflow": "auto",
              "position": "relative",
              "scrollbarWidth": "none",
              "&::-webkit-scrollbar": {
                "display": "none",
              },
            },
            "trigger": {
              "alignItems": "center",
              "color": "fg.muted",
              "cursor": "pointer",
              "display": "inline-flex",
              "flexShrink": "0",
              "fontWeight": "semibold",
              "gap": "2",
              "justifyContent": "center",
              "transitionDuration": "normal",
              "transitionProperty": "color, background, border-color",
              "transitionTimingFunction": "default",
              "whiteSpace": "nowrap",
              "zIndex": "1",
              "_disabled": {
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "color": "fg.disabled",
                },
              },
              "_hover": {
                "color": "fg.muted",
              },
              "_selected": {
                "color": "fg.default",
                "_hover": {
                  "color": "fg.default",
                },
              },
              "_vertical": {
                "justifyContent": "flex-start",
              },
            },
          },
          "defaultVariants": {
            "size": "md",
            "variant": "line",
          },
          "variants": {
            "variant": {
              "enclosed": {
                "list": {
                  "borderRadius": "l3",
                  "borderWidth": "1px",
                  "px": "1",
                  "backgroundColor": {
                    "_light": "gray.a2",
                    "_dark": "bg.canvas",
                  },
                  "_horizontal": {
                    "alignItems": "center",
                  },
                  "_vertical": {
                    "height": "fit-content!",
                    "py": "1",
                  },
                },
                "indicator": {
                  "backgroundColor": {
                    "_light": "bg.default",
                    "_dark": "bg.subtle",
                  },
                  "boxShadow": "xs",
                  "borderRadius": "l2",
                  "--transition-duration": "200ms!",
                  "height": "var(--height)",
                  "width": "var(--width)",
                },
              },
              "line": {
                "list": {
                  "_horizontal": {
                    "boxShadow":
                      "0 -1px 0 0 inset var(--colors-border-default)",
                    "gap": "4",
                  },
                  "_vertical": {
                    "boxShadow": "1px 0 0 0 inset var(--colors-border-default)",
                    "gap": "1",
                  },
                },
                "indicator": {
                  "background": "colorPalette.default",
                  "_horizontal": {
                    "bottom": "0",
                    "height": "2px",
                    "width": "var(--width)",
                  },
                  "_vertical": {
                    "height": "var(--height)",
                    "left": "0",
                    "width": "2px",
                  },
                },
                "content": {
                  "pt": "4",
                },
                "trigger": {
                  "_horizontal": {
                    "pb": "2.5",
                  },
                },
              },
              "outline": {
                "list": {
                  "_horizontal": {
                    "mb": "-1px",
                  },
                  "_vertical": {
                    "mr": "-1px",
                  },
                },
                "trigger": {
                  "borderColor": "transparent",
                  "borderWidth": "1px",
                  "_horizontal": {
                    "borderTopRadius": "l2",
                  },
                  "_vertical": {
                    "borderTopLeftRadius": "l2",
                    "borderBottomLeftRadius": "l2",
                  },
                  "_selected": {
                    "background": "bg.default",
                    "borderColor": "border.subtle",
                    "_horizontal": {
                      "borderBottomColor": "transparent",
                    },
                    "_vertical": {
                      "borderRightColor": "transparent",
                    },
                  },
                },
                "content": {
                  "borderWidth": "1px",
                  "borderColor": "border.subtle",
                  "background": "bg.default",
                  "width": "full",
                },
              },
            },
            "size": {
              "sm": {
                "trigger": {
                  "& svg": {
                    "width": "4",
                    "height": "4",
                  },
                },
              },
              "md": {
                "trigger": {
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
              "lg": {
                "trigger": {
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
            },
          },
          "compoundVariants": [
            {
              "size": "sm",
              "variant": "enclosed",
              "css": {
                "list": {
                  "height": "10",
                },
                "trigger": {
                  "h": "8",
                  "minW": "8",
                  "textStyle": "sm",
                  "px": "3",
                },
                "content": {
                  "p": "3.5",
                },
              },
            },
            {
              "size": "md",
              "variant": "enclosed",
              "css": {
                "list": {
                  "height": "11",
                },
                "trigger": {
                  "h": "9",
                  "minW": "9",
                  "textStyle": "sm",
                  "px": "3.5",
                },
                "content": {
                  "p": "4",
                },
              },
            },
            {
              "size": "lg",
              "variant": "enclosed",
              "css": {
                "list": {
                  "height": "12",
                },
                "trigger": {
                  "h": "10",
                  "minW": "10",
                  "textStyle": "sm",
                  "px": "4",
                },
                "content": {
                  "p": "4.5",
                },
              },
            },
            {
              "size": "sm",
              "variant": "outline",
              "css": {
                "trigger": {
                  "h": "9",
                  "minW": "9",
                  "textStyle": "sm",
                  "px": "3.5",
                },
                "content": {
                  "p": "3.5",
                },
              },
            },
            {
              "size": "md",
              "variant": "outline",
              "css": {
                "trigger": {
                  "h": "10",
                  "minW": "10",
                  "textStyle": "sm",
                  "px": "4",
                },
                "content": {
                  "p": "4",
                },
              },
            },
            {
              "size": "lg",
              "variant": "outline",
              "css": {
                "trigger": {
                  "h": "11",
                  "minW": "11",
                  "textStyle": "md",
                  "px": "4.5",
                },
                "content": {
                  "p": "4.5",
                },
              },
            },
            {
              "size": "sm",
              "variant": "line",
              "css": {
                "trigger": {
                  "fontSize": "sm",
                  "h": "9",
                  "minW": "9",
                  "px": "2.5",
                },
                "content": {
                  "pt": "3",
                },
              },
            },
            {
              "size": "md",
              "variant": "line",
              "css": {
                "trigger": {
                  "fontSize": "md",
                  "h": "10",
                  "minW": "10",
                  "px": "3",
                },
                "content": {
                  "pt": "4",
                },
              },
            },
            {
              "size": "lg",
              "variant": "line",
              "css": {
                "trigger": {
                  "px": "3.5",
                  "h": "11",
                  "minW": "11",
                  "fontSize": "md",
                },
                "content": {
                  "pt": "5",
                },
              },
            },
          ],
        },
        "tagsInput": {
          "className": "tagsInput",
          "slots": [
            "root",
            "label",
            "control",
            "input",
            "clearTrigger",
            "item",
            "itemPreview",
            "itemInput",
            "itemText",
            "itemDeleteTrigger",
          ],
          "base": {
            "root": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "1.5",
              "width": "full",
            },
            "control": {
              "alignItems": "center",
              "borderColor": "border.default",
              "borderRadius": "l2",
              "borderWidth": "1px",
              "display": "flex",
              "flexWrap": "wrap",
              "outline": 0,
              "transitionDuration": "normal",
              "transitionProperty": "border-color, box-shadow",
              "transitionTimingFunction": "default",
              "_focusWithin": {
                "borderColor": "colorPalette.default",
                "boxShadow": "0 0 0 1px var(--colors-color-palette-default)",
              },
            },
            "input": {
              "background": "transparent",
              "color": "fg.default",
              "outline": "none",
            },
            "itemPreview": {
              "alignItems": "center",
              "borderColor": "border.default",
              "borderRadius": "l1",
              "borderWidth": "1px",
              "color": "fg.default",
              "display": "inline-flex",
              "fontWeight": "medium",
              "_highlighted": {
                "borderColor": "colorPalette.default",
                "boxShadow": "0 0 0 1px var(--colors-color-palette-default)",
              },
              "_hidden": {
                "display": "none",
              },
            },
            "itemInput": {
              "background": "transparent",
              "color": "fg.default",
              "outline": "none",
            },
            "label": {
              "color": "fg.default",
              "fontWeight": "medium",
              "textStyle": "sm",
            },
          },
          "defaultVariants": {
            "size": "md",
          },
          "variants": {
            "size": {
              "md": {
                "root": {
                  "gap": "1.5",
                },
                "control": {
                  "fontSize": "md",
                  "gap": "1.5",
                  "minW": "10",
                  "px": "3",
                  "py": "7px",
                },
                "itemPreview": {
                  "gap": "1",
                  "h": "6",
                  "pe": "1",
                  "ps": "2",
                  "textStyle": "sm",
                },
              },
            },
          },
        },
        "toast": {
          "className": "toast",
          "slots": [
            "group",
            "root",
            "title",
            "description",
            "actionTrigger",
            "closeTrigger",
          ],
          "base": {
            "root": {
              "background": "bg.default",
              "borderRadius": "l3",
              "boxShadow": "lg",
              "minWidth": "xs",
              "height": "var(--height)",
              "opacity": "var(--opacity)",
              "overflowWrap": "anywhere",
              "p": "4",
              "position": "relative",
              "scale": "var(--scale)",
              "translate": "var(--x) var(--y) 0",
              "willChange": "translate, opacity, scale",
              "zIndex": "var(--z-index)",
              "transitionDuration": "slow",
              "transitionProperty": "translate, scale, opacity, height",
              "transitionTimingFunction": "default",
            },
            "title": {
              "color": "fg.default",
              "fontWeight": "semibold",
              "textStyle": "sm",
            },
            "description": {
              "color": "fg.muted",
              "textStyle": "sm",
            },
            "actionTrigger": {
              "mt": "2",
            },
            "closeTrigger": {
              "position": "absolute",
              "top": "3",
              "right": "3",
            },
          },
        },
        "toggleGroup": {
          "className": "toggleGroup",
          "slots": [
            "root",
            "item",
          ],
          "base": {
            "root": {
              "display": "flex",
              "overflow": "hidden",
              "position": "relative",
              "_vertical": {
                "flexDirection": "column",
              },
            },
            "item": {
              "alignItems": "center",
              "appearance": "none",
              "cursor": "pointer",
              "color": "fg.subtle",
              "display": "inline-flex",
              "fontWeight": "semibold",
              "minWidth": "0",
              "justifyContent": "center",
              "outline": "none",
              "position": "relative",
              "transitionDuration": "normal",
              "transitionProperty":
                "background, border-color, color, box-shadow",
              "transitionTimingFunction": "default",
              "userSelect": "none",
              "verticalAlign": "middle",
              "whiteSpace": "nowrap",
              "_on": {
                "background": "gray.a3",
                "color": "fg.default",
                "_hover": {
                  "background": "gray.a3",
                },
              },
              "_hover": {
                "background": "gray.a2",
              },
              "_disabled": {
                "borderColor": "border.disabled",
                "color": "fg.disabled",
                "cursor": "not-allowed",
                "_hover": {
                  "background": "transparent",
                  "borderColor": "border.disabled",
                  "color": "fg.disabled",
                },
              },
            },
          },
          "defaultVariants": {
            "size": "md",
            "variant": "outline",
          },
          "variants": {
            "variant": {
              "outline": {
                "root": {
                  "borderWidth": "1px",
                  "borderRadius": "l2",
                  "borderColor": "border.default",
                  "_horizontal": {
                    "divideX": "1px",
                  },
                  "_vertical": {
                    "divideY": "1px",
                  },
                },
                "item": {
                  "borderColor": "border.default",
                  "_focusVisible": {
                    "color": "fg.default",
                    "background": "gray.a3",
                  },
                },
              },
              "ghost": {
                "root": {
                  "gap": "1",
                },
                "item": {
                  "borderRadius": "l2",
                  "_focusVisible": {
                    "outlineOffset": "2px",
                    "outline": "2px solid",
                    "outlineColor": "border.outline",
                  },
                },
              },
            },
            "size": {
              "sm": {
                "item": {
                  "h": "9",
                  "minW": "9",
                  "textStyle": "sm",
                  "gap": "2",
                  "& svg": {
                    "width": "4.5",
                    "height": "4.5",
                  },
                },
              },
              "md": {
                "item": {
                  "h": "10",
                  "minW": "10",
                  "textStyle": "sm",
                  "gap": "2",
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
              "lg": {
                "item": {
                  "h": "11",
                  "minW": "11",
                  "textStyle": "md",
                  "gap": "2",
                  "& svg": {
                    "width": "5",
                    "height": "5",
                  },
                },
              },
            },
          },
        },
        "tooltip": {
          "className": "tooltip",
          "slots": [
            "trigger",
            "arrow",
            "arrowTip",
            "positioner",
            "content",
          ],
          "base": {
            "content": {
              "background": "gray.a12",
              "borderRadius": "l2",
              "boxShadow": "sm",
              "color": "bg.default",
              "fontWeight": "semibold",
              "px": "3",
              "py": "2",
              "textStyle": "xs",
              "maxWidth": "2xs",
              "zIndex": "tooltip",
              "_open": {
                "animation": "fadeIn 0.25s ease-out",
              },
              "_closed": {
                "animation": "fadeOut 0.2s ease-out",
              },
            },
          },
        },
        "treeView": {
          "className": "treeView",
          "slots": [
            "root",
            "label",
            "tree",
            "item",
            "itemIndicator",
            "itemText",
            "branch",
            "branchControl",
            "branchTrigger",
            "branchContent",
            "branchText",
            "branchIndicator",
            "branchIndentGuide",
          ],
          "base": {
            "root": {
              "width": "full",
            },
            "branch": {
              "&[data-depth='1'] > [data-part='branch-content']": {
                "_before": {
                  "bg": "border.default",
                  "content": '""',
                  "height": "full",
                  "left": "3",
                  "position": "absolute",
                  "width": "1px",
                  "zIndex": "1",
                },
              },
            },
            "branchContent": {
              "position": "relative",
            },
            "branchIndentGuide": {},
            "branchControl": {
              "alignItems": "center",
              "borderRadius": "l2",
              "color": "fg.muted",
              "display": "flex",
              "fontWeight": "medium",
              "gap": "1.5",
              "ps": "calc((var(--depth) - 1) * 22px)",
              "py": "1.5",
              "textStyle": "sm",
              "transitionDuration": "normal",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
              "&[data-depth='1']": {
                "ps": "1",
              },
              "&[data-depth='1'] > [data-part='branch-text'] ": {
                "fontWeight": "semibold",
                "color": "fg.default",
              },
              "_hover": {
                "background": "gray.a2",
                "color": "fg.default",
              },
            },
            "branchIndicator": {
              "color": "accent.default",
              "transformOrigin": "center",
              "transitionDuration": "normal",
              "transitionProperty": "transform",
              "transitionTimingFunction": "default",
              "& svg": {
                "fontSize": "md",
                "width": "4",
                "height": "4",
              },
              "_open": {
                "transform": "rotate(90deg)",
              },
            },
            "item": {
              "borderRadius": "l2",
              "color": "fg.muted",
              "cursor": "pointer",
              "fontWeight": "medium",
              "position": "relative",
              "ps": "calc(((var(--depth) - 1) * 22px) + 22px)",
              "py": "1.5",
              "textStyle": "sm",
              "transitionDuration": "normal",
              "transitionProperty": "background, color",
              "transitionTimingFunction": "default",
              "&[data-depth='1']": {
                "ps": "6",
                "fontWeight": "semibold",
                "color": "fg.default",
                "_selected": {
                  "_before": {
                    "bg": "transparent",
                  },
                },
              },
              "_hover": {
                "background": "gray.a2",
                "color": "fg.default",
              },
              "_selected": {
                "background": "accent.a2",
                "color": "accent.text",
                "_hover": {
                  "background": "accent.a2",
                  "color": "accent.text",
                },
                "_before": {
                  "content": '""',
                  "position": "absolute",
                  "left": "3",
                  "top": "0",
                  "width": "2px",
                  "height": "full",
                  "bg": "accent.default",
                  "zIndex": "1",
                },
              },
            },
            "tree": {
              "display": "flex",
              "flexDirection": "column",
              "gap": "3",
            },
          },
        },
        "qrCode": {
          "className": "qrCode",
          "slots": [
            "root",
            "frame",
            "pattern",
            "overlay",
          ],
          "base": {},
        },
      },
      "textStyles": {
        "xs": {
          "value": {
            "fontSize": "xs",
            "lineHeight": "1.125rem",
          },
        },
        "sm": {
          "value": {
            "fontSize": "sm",
            "lineHeight": "1.25rem",
          },
        },
        "md": {
          "value": {
            "fontSize": "md",
            "lineHeight": "1.5rem",
          },
        },
        "lg": {
          "value": {
            "fontSize": "lg",
            "lineHeight": "1.75rem",
          },
        },
        "xl": {
          "value": {
            "fontSize": "xl",
            "lineHeight": "1.875rem",
          },
        },
        "2xl": {
          "value": {
            "fontSize": "2xl",
            "lineHeight": "2rem",
          },
        },
        "3xl": {
          "value": {
            "fontSize": "3xl",
            "lineHeight": "2.375rem",
          },
        },
        "4xl": {
          "value": {
            "fontSize": "4xl",
            "lineHeight": "2.75rem",
            "letterSpacing": "-0.02em",
          },
        },
        "5xl": {
          "value": {
            "fontSize": "5xl",
            "lineHeight": "3.75rem",
            "letterSpacing": "-0.02em",
          },
        },
        "6xl": {
          "value": {
            "fontSize": "6xl",
            "lineHeight": "4.5rem",
            "letterSpacing": "-0.02em",
          },
        },
        "7xl": {
          "value": {
            "fontSize": "7xl",
            "lineHeight": "5.75rem",
            "letterSpacing": "-0.02em",
          },
        },
      },
      "tokens": {
        "animations": {
          "backdrop-in": {
            "value": "fade-in 250ms {easings.emphasized-in}",
          },
          "backdrop-out": {
            "value": "fade-out 200ms {easings.emphasized-out}",
          },
          "dialog-in": {
            "value": "slide-in 400ms {easings.emphasized-in}",
          },
          "dialog-out": {
            "value": "slide-out 200ms {easings.emphasized-out}",
          },
          "drawer-in-left": {
            "value": "slide-in-left 400ms {easings.emphasized-in}",
          },
          "drawer-out-left": {
            "value": "slide-out-left 200ms {easings.emphasized-out}",
          },
          "drawer-in-right": {
            "value": "slide-in-right 400ms {easings.emphasized-in}",
          },
          "drawer-out-right": {
            "value": "slide-out-right 200ms {easings.emphasized-out}",
          },
          "skeleton-pulse": {
            "value": "skeleton-pulse 2s {easings.pulse} infinite",
          },
          "fade-in": {
            "value": "fade-in 400ms {easings.emphasized-in}",
          },
          "collapse-in": {
            "value": "collapse-in 250ms {easings.emphasized-in}",
          },
          "collapse-out": {
            "value": "collapse-out 200ms {easings.emphasized-out}",
          },
          "spin": {
            "value": "spin 1s linear infinite",
          },
        },
        "blurs": {
          "sm": {
            "value": "4px",
          },
          "base": {
            "value": "8px",
          },
          "md": {
            "value": "12px",
          },
          "lg": {
            "value": "16px",
          },
          "xl": {
            "value": "24px",
          },
          "2xl": {
            "value": "40px",
          },
          "3xl": {
            "value": "64px",
          },
        },
        "borders": {
          "none": {
            "value": "none",
          },
        },
        "colors": {
          "current": {
            "value": "currentColor",
          },
          "black": {
            "DEFAULT": {
              "value": "#000000",
            },
            "a1": {
              "value": "rgba(0, 0, 0, 0.05)",
            },
            "a2": {
              "value": "rgba(0, 0, 0, 0.1)",
            },
            "a3": {
              "value": "rgba(0, 0, 0, 0.15)",
            },
            "a4": {
              "value": "rgba(0, 0, 0, 0.2)",
            },
            "a5": {
              "value": "rgba(0, 0, 0, 0.3)",
            },
            "a6": {
              "value": "rgba(0, 0, 0, 0.4)",
            },
            "a7": {
              "value": "rgba(0, 0, 0, 0.5)",
            },
            "a8": {
              "value": "rgba(0, 0, 0, 0.6)",
            },
            "a9": {
              "value": "rgba(0, 0, 0, 0.7)",
            },
            "a10": {
              "value": "rgba(0, 0, 0, 0.8)",
            },
            "a11": {
              "value": "rgba(0, 0, 0, 0.9)",
            },
            "a12": {
              "value": "rgba(0, 0, 0, 0.95)",
            },
          },
          "white": {
            "DEFAULT": {
              "value": "#ffffff",
            },
            "a1": {
              "value": "rgba(255, 255, 255, 0.05)",
            },
            "a2": {
              "value": "rgba(255, 255, 255, 0.1)",
            },
            "a3": {
              "value": "rgba(255, 255, 255, 0.15)",
            },
            "a4": {
              "value": "rgba(255, 255, 255, 0.2)",
            },
            "a5": {
              "value": "rgba(255, 255, 255, 0.3)",
            },
            "a6": {
              "value": "rgba(255, 255, 255, 0.4)",
            },
            "a7": {
              "value": "rgba(255, 255, 255, 0.5)",
            },
            "a8": {
              "value": "rgba(255, 255, 255, 0.6)",
            },
            "a9": {
              "value": "rgba(255, 255, 255, 0.7)",
            },
            "a10": {
              "value": "rgba(255, 255, 255, 0.8)",
            },
            "a11": {
              "value": "rgba(255, 255, 255, 0.9)",
            },
            "a12": {
              "value": "rgba(255, 255, 255, 0.95)",
            },
          },
          "transparent": {
            "value": "rgb(0 0 0 / 0)",
          },
          "red": {
            "light": {
              "1": {
                "value": "#fffcfc",
              },
              "2": {
                "value": "#fff7f7",
              },
              "3": {
                "value": "#feebec",
              },
              "4": {
                "value": "#ffdbdc",
              },
              "5": {
                "value": "#ffcdce",
              },
              "6": {
                "value": "#fdbdbe",
              },
              "7": {
                "value": "#f4a9aa",
              },
              "8": {
                "value": "#eb8e90",
              },
              "9": {
                "value": "#e5484d",
              },
              "10": {
                "value": "#dc3e42",
              },
              "11": {
                "value": "#ce2c31",
              },
              "12": {
                "value": "#641723",
              },
              "a1": {
                "value": "#ff000003",
              },
              "a2": {
                "value": "#ff000008",
              },
              "a3": {
                "value": "#f3000d14",
              },
              "a4": {
                "value": "#ff000824",
              },
              "a5": {
                "value": "#ff000632",
              },
              "a6": {
                "value": "#f8000442",
              },
              "a7": {
                "value": "#df000356",
              },
              "a8": {
                "value": "#d2000571",
              },
              "a9": {
                "value": "#db0007b7",
              },
              "a10": {
                "value": "#d10005c1",
              },
              "a11": {
                "value": "#c40006d3",
              },
              "a12": {
                "value": "#55000de8",
              },
            },
            "dark": {
              "1": {
                "value": "#191111",
              },
              "2": {
                "value": "#201314",
              },
              "3": {
                "value": "#3b1219",
              },
              "4": {
                "value": "#500f1c",
              },
              "5": {
                "value": "#611623",
              },
              "6": {
                "value": "#72232d",
              },
              "7": {
                "value": "#8c333a",
              },
              "8": {
                "value": "#b54548",
              },
              "9": {
                "value": "#e5484d",
              },
              "10": {
                "value": "#ec5d5e",
              },
              "11": {
                "value": "#ff9592",
              },
              "12": {
                "value": "#ffd1d9",
              },
              "a1": {
                "value": "#f4121209",
              },
              "a2": {
                "value": "#f22f3e11",
              },
              "a3": {
                "value": "#ff173f2d",
              },
              "a4": {
                "value": "#fe0a3b44",
              },
              "a5": {
                "value": "#ff204756",
              },
              "a6": {
                "value": "#ff3e5668",
              },
              "a7": {
                "value": "#ff536184",
              },
              "a8": {
                "value": "#ff5d61b0",
              },
              "a9": {
                "value": "#fe4e54e4",
              },
              "a10": {
                "value": "#ff6465eb",
              },
              "a11": {
                "value": "#ff9592",
              },
              "a12": {
                "value": "#ffd1d9",
              },
            },
          },
          "gray": {
            "light": {
              "1": {
                "value": "#fcfcfd",
              },
              "2": {
                "value": "#f9f9fb",
              },
              "3": {
                "value": "#f0f0f3",
              },
              "4": {
                "value": "#e8e8ec",
              },
              "5": {
                "value": "#e0e1e6",
              },
              "6": {
                "value": "#d9d9e0",
              },
              "7": {
                "value": "#cdced6",
              },
              "8": {
                "value": "#b9bbc6",
              },
              "9": {
                "value": "#8b8d98",
              },
              "10": {
                "value": "#80838d",
              },
              "11": {
                "value": "#60646c",
              },
              "12": {
                "value": "#1c2024",
              },
              "a1": {
                "value": "#00005503",
              },
              "a2": {
                "value": "#00005506",
              },
              "a3": {
                "value": "#0000330f",
              },
              "a4": {
                "value": "#00002d17",
              },
              "a5": {
                "value": "#0009321f",
              },
              "a6": {
                "value": "#00002f26",
              },
              "a7": {
                "value": "#00062e32",
              },
              "a8": {
                "value": "#00083046",
              },
              "a9": {
                "value": "#00051d74",
              },
              "a10": {
                "value": "#00071b7f",
              },
              "a11": {
                "value": "#0007149f",
              },
              "a12": {
                "value": "#000509e3",
              },
            },
            "dark": {
              "1": {
                "value": "#111113",
              },
              "2": {
                "value": "#18191b",
              },
              "3": {
                "value": "#212225",
              },
              "4": {
                "value": "#272a2d",
              },
              "5": {
                "value": "#2e3135",
              },
              "6": {
                "value": "#363a3f",
              },
              "7": {
                "value": "#43484e",
              },
              "8": {
                "value": "#5a6169",
              },
              "9": {
                "value": "#696e77",
              },
              "10": {
                "value": "#777b84",
              },
              "11": {
                "value": "#b0b4ba",
              },
              "12": {
                "value": "#edeef0",
              },
              "a1": {
                "value": "#00000000",
              },
              "a2": {
                "value": "#d8f4f609",
              },
              "a3": {
                "value": "#ddeaf814",
              },
              "a4": {
                "value": "#d3edf81d",
              },
              "a5": {
                "value": "#d9edfe25",
              },
              "a6": {
                "value": "#d6ebfd30",
              },
              "a7": {
                "value": "#d9edff40",
              },
              "a8": {
                "value": "#d9edff5d",
              },
              "a9": {
                "value": "#dfebfd6d",
              },
              "a10": {
                "value": "#e5edfd7b",
              },
              "a11": {
                "value": "#f1f7feb5",
              },
              "a12": {
                "value": "#fcfdffef",
              },
            },
          },
          "brandcyan": {
            "light": {
              "1": {
                "value": "#f5fefe",
              },
              "2": {
                "value": "#e8fbfb",
              },
              "3": {
                "value": "#d5f5f6",
              },
              "4": {
                "value": "#c2efef",
              },
              "5": {
                "value": "#ade7e7",
              },
              "6": {
                "value": "#96dcdd",
              },
              "7": {
                "value": "#76cdcf",
              },
              "8": {
                "value": "#49b9bb",
              },
              "9": {
                "value": "#1dc7cb",
              },
              "10": {
                "value": "#1eb9bc",
              },
              "11": {
                "value": "#008d90",
              },
              "12": {
                "value": "#0c5d5f",
              },
              "a1": {
                "value": "#00e6e60a",
              },
              "a2": {
                "value": "#00d3d317",
              },
              "a3": {
                "value": "#00c2c82a",
              },
              "a4": {
                "value": "#00bcbc3d",
              },
              "a5": {
                "value": "#00b4b452",
              },
              "a6": {
                "value": "#00aaac69",
              },
              "a7": {
                "value": "#00a2a689",
              },
              "a8": {
                "value": "#009da0b6",
              },
              "a9": {
                "value": "#00c0c4e2",
              },
              "a10": {
                "value": "#00b0b3e1",
              },
              "a11": {
                "value": "#008d90ff",
              },
              "a12": {
                "value": "#005557f3",
              },
            },
            "dark": {
              "1": {
                "value": "#0c1a1b",
              },
              "2": {
                "value": "#0a2223",
              },
              "3": {
                "value": "#042e2f",
              },
              "4": {
                "value": "#02393a",
              },
              "5": {
                "value": "#044446",
              },
              "6": {
                "value": "#005456",
              },
              "7": {
                "value": "#05696b",
              },
              "8": {
                "value": "#128587",
              },
              "9": {
                "value": "#2DE2E6",
              },
              "10": {
                "value": "#15d5d9",
              },
              "11": {
                "value": "#86ebed",
              },
              "12": {
                "value": "#c7f8f8",
              },
              "a1": {
                "value": "#0c1a1b05",
              },
              "a2": {
                "value": "#00feff09",
              },
              "a3": {
                "value": "#00feff16",
              },
              "a4": {
                "value": "#00feff23",
              },
              "a5": {
                "value": "#00f9ff30",
              },
              "a6": {
                "value": "#00faff42",
              },
              "a7": {
                "value": "#00fbff59",
              },
              "a8": {
                "value": "#19fcff79",
              },
              "a9": {
                "value": "#31fbffe3",
              },
              "a10": {
                "value": "#17faffd5",
              },
              "a11": {
                "value": "#90fdffeb",
              },
              "a12": {
                "value": "#cdfffff7",
              },
            },
          },
        },
        "durations": {
          "fastest": {
            "value": "50ms",
          },
          "faster": {
            "value": "100ms",
          },
          "fast": {
            "value": "150ms",
          },
          "normal": {
            "value": "200ms",
          },
          "slow": {
            "value": "300ms",
          },
          "slower": {
            "value": "400ms",
          },
          "slowest": {
            "value": "500ms",
          },
        },
        "easings": {
          "pulse": {
            "value": "cubic-bezier(0.4, 0.0, 0.6, 1.0)",
          },
          "default": {
            "value": "cubic-bezier(0.2, 0.0, 0, 1.0)",
          },
          "emphasized-in": {
            "value": "cubic-bezier(0.05, 0.7, 0.1, 1.0)",
          },
          "emphasized-out": {
            "value": "cubic-bezier(0.3, 0.0, 0.8, 0.15)",
          },
        },
        "fonts": {
          "sans": {
            "value": [
              "ui-sans-serif",
              "system-ui",
              "-apple-system",
              "BlinkMacSystemFont",
              '"Segoe UI"',
              "Roboto",
              '"Helvetica Neue"',
              "Arial",
              '"Noto Sans"',
              "sans-serif",
              '"Apple Color Emoji"',
              '"Segoe UI Emoji"',
              '"Segoe UI Symbol"',
              '"Noto Color Emoji"',
            ],
          },
          "serif": {
            "value": [
              "ui-serif",
              "Georgia",
              "Cambria",
              '"Times New Roman"',
              "Times",
              "serif",
            ],
          },
          "mono": {
            "value": [
              "ui-monospace",
              "SFMono-Regular",
              "Menlo",
              "Monaco",
              "Consolas",
              '"Liberation Mono"',
              '"Courier New"',
              "monospace",
            ],
          },
        },
        "fontSizes": {
          "2xs": {
            "value": "0.5rem",
          },
          "xs": {
            "value": "0.75rem",
          },
          "sm": {
            "value": "0.875rem",
          },
          "md": {
            "value": "1rem",
          },
          "lg": {
            "value": "1.125rem",
          },
          "xl": {
            "value": "1.25rem",
          },
          "2xl": {
            "value": "1.5rem",
          },
          "3xl": {
            "value": "1.875rem",
          },
          "4xl": {
            "value": "2.25rem",
          },
          "5xl": {
            "value": "3rem",
          },
          "6xl": {
            "value": "3.75rem",
          },
          "7xl": {
            "value": "4.5rem",
          },
          "8xl": {
            "value": "6rem",
          },
          "9xl": {
            "value": "8rem",
          },
        },
        "fontWeights": {
          "thin": {
            "value": "100",
          },
          "extralight": {
            "value": "200",
          },
          "light": {
            "value": "300",
          },
          "normal": {
            "value": "400",
          },
          "medium": {
            "value": "500",
          },
          "semibold": {
            "value": "600",
          },
          "bold": {
            "value": "700",
          },
          "extrabold": {
            "value": "800",
          },
          "black": {
            "value": "900",
          },
        },
        "letterSpacings": {
          "tighter": {
            "value": "-0.05em",
          },
          "tight": {
            "value": "-0.025em",
          },
          "normal": {
            "value": "0em",
          },
          "wide": {
            "value": "0.025em",
          },
          "wider": {
            "value": "0.05em",
          },
          "widest": {
            "value": "0.1em",
          },
        },
        "lineHeights": {
          "none": {
            "value": "1",
          },
          "tight": {
            "value": "1.25",
          },
          "normal": {
            "value": "1.5",
          },
          "relaxed": {
            "value": "1.75",
          },
          "loose": {
            "value": "2",
          },
        },
        "radii": {
          "none": {
            "value": "0",
          },
          "2xs": {
            "value": "0.0625rem",
          },
          "xs": {
            "value": "0.125rem",
          },
          "sm": {
            "value": "0.25rem",
          },
          "md": {
            "value": "0.375rem",
          },
          "lg": {
            "value": "0.5rem",
          },
          "xl": {
            "value": "0.75rem",
          },
          "2xl": {
            "value": "1rem",
          },
          "3xl": {
            "value": "1.5rem",
          },
          "full": {
            "value": "9999px",
          },
        },
        "sizes": {
          "0": {
            "value": "0rem",
          },
          "1": {
            "value": "0.25rem",
          },
          "2": {
            "value": "0.5rem",
          },
          "3": {
            "value": "0.75rem",
          },
          "4": {
            "value": "1rem",
          },
          "5": {
            "value": "1.25rem",
          },
          "6": {
            "value": "1.5rem",
          },
          "7": {
            "value": "1.75rem",
          },
          "8": {
            "value": "2rem",
          },
          "9": {
            "value": "2.25rem",
          },
          "10": {
            "value": "2.5rem",
          },
          "11": {
            "value": "2.75rem",
          },
          "12": {
            "value": "3rem",
          },
          "14": {
            "value": "3.5rem",
          },
          "16": {
            "value": "4rem",
          },
          "20": {
            "value": "5rem",
          },
          "24": {
            "value": "6rem",
          },
          "28": {
            "value": "7rem",
          },
          "32": {
            "value": "8rem",
          },
          "36": {
            "value": "9rem",
          },
          "40": {
            "value": "10rem",
          },
          "44": {
            "value": "11rem",
          },
          "48": {
            "value": "12rem",
          },
          "52": {
            "value": "13rem",
          },
          "56": {
            "value": "14rem",
          },
          "60": {
            "value": "15rem",
          },
          "64": {
            "value": "16rem",
          },
          "72": {
            "value": "18rem",
          },
          "80": {
            "value": "20rem",
          },
          "96": {
            "value": "24rem",
          },
          "0.5": {
            "value": "0.125rem",
          },
          "1.5": {
            "value": "0.375rem",
          },
          "2.5": {
            "value": "0.625rem",
          },
          "3.5": {
            "value": "0.875rem",
          },
          "4.5": {
            "value": "1.125rem",
          },
          "2xs": {
            "value": "16rem",
          },
          "xs": {
            "value": "20rem",
          },
          "sm": {
            "value": "24rem",
          },
          "md": {
            "value": "28rem",
          },
          "lg": {
            "value": "32rem",
          },
          "xl": {
            "value": "36rem",
          },
          "2xl": {
            "value": "42rem",
          },
          "3xl": {
            "value": "48rem",
          },
          "4xl": {
            "value": "56rem",
          },
          "5xl": {
            "value": "64rem",
          },
          "6xl": {
            "value": "72rem",
          },
          "7xl": {
            "value": "80rem",
          },
          "8xl": {
            "value": "90rem",
          },
          "full": {
            "value": "100%",
          },
          "min": {
            "value": "min-content",
          },
          "max": {
            "value": "max-content",
          },
          "fit": {
            "value": "fit-content",
          },
        },
        "spacing": {
          "0": {
            "value": "0rem",
          },
          "1": {
            "value": "0.25rem",
          },
          "2": {
            "value": "0.5rem",
          },
          "3": {
            "value": "0.75rem",
          },
          "4": {
            "value": "1rem",
          },
          "5": {
            "value": "1.25rem",
          },
          "6": {
            "value": "1.5rem",
          },
          "7": {
            "value": "1.75rem",
          },
          "8": {
            "value": "2rem",
          },
          "9": {
            "value": "2.25rem",
          },
          "10": {
            "value": "2.5rem",
          },
          "11": {
            "value": "2.75rem",
          },
          "12": {
            "value": "3rem",
          },
          "14": {
            "value": "3.5rem",
          },
          "16": {
            "value": "4rem",
          },
          "20": {
            "value": "5rem",
          },
          "24": {
            "value": "6rem",
          },
          "28": {
            "value": "7rem",
          },
          "32": {
            "value": "8rem",
          },
          "36": {
            "value": "9rem",
          },
          "40": {
            "value": "10rem",
          },
          "44": {
            "value": "11rem",
          },
          "48": {
            "value": "12rem",
          },
          "52": {
            "value": "13rem",
          },
          "56": {
            "value": "14rem",
          },
          "60": {
            "value": "15rem",
          },
          "64": {
            "value": "16rem",
          },
          "72": {
            "value": "18rem",
          },
          "80": {
            "value": "20rem",
          },
          "96": {
            "value": "24rem",
          },
          "0.5": {
            "value": "0.125rem",
          },
          "1.5": {
            "value": "0.375rem",
          },
          "2.5": {
            "value": "0.625rem",
          },
          "3.5": {
            "value": "0.875rem",
          },
          "4.5": {
            "value": "1.125rem",
          },
        },
        "zIndex": {
          "hide": {
            "value": -1,
          },
          "base": {
            "value": 0,
          },
          "docked": {
            "value": 10,
          },
          "dropdown": {
            "value": 1000,
          },
          "sticky": {
            "value": 1100,
          },
          "banner": {
            "value": 1200,
          },
          "overlay": {
            "value": 1300,
          },
          "modal": {
            "value": 1400,
          },
          "popover": {
            "value": 1500,
          },
          "skipLink": {
            "value": 1600,
          },
          "toast": {
            "value": 1700,
          },
          "tooltip": {
            "value": 1800,
          },
        },
      },
      "semanticTokens": {
        "colors": {
          "bg": {
            "canvas": {
              "value": {
                "_light": "{colors.gray.1}",
                "_dark": "{colors.gray.1}",
              },
            },
            "default": {
              "value": {
                "_light": "white",
                "_dark": "{colors.gray.2}",
              },
            },
            "subtle": {
              "value": {
                "_light": "{colors.gray.2}",
                "_dark": "{colors.gray.3}",
              },
            },
            "muted": {
              "value": {
                "_light": "{colors.gray.3}",
                "_dark": "{colors.gray.4}",
              },
            },
            "emphasized": {
              "value": {
                "_light": "{colors.gray.4}",
                "_dark": "{colors.gray.5}",
              },
            },
            "disabled": {
              "value": {
                "_light": "{colors.gray.5}",
                "_dark": "{colors.gray.6}",
              },
            },
          },
          "fg": {
            "default": {
              "value": {
                "_light": "{colors.gray.12}",
                "_dark": "{colors.gray.12}",
              },
            },
            "muted": {
              "value": {
                "_light": "{colors.gray.11}",
                "_dark": "{colors.gray.11}",
              },
            },
            "subtle": {
              "value": {
                "_light": "{colors.gray.10}",
                "_dark": "{colors.gray.10}",
              },
            },
            "disabled": {
              "value": {
                "_light": "{colors.gray.9}",
                "_dark": "{colors.gray.9}",
              },
            },
            "error": {
              "value": {
                "_light": "{colors.red.9}",
                "_dark": "{colors.red.9}",
              },
            },
          },
          "border": {
            "default": {
              "value": {
                "_light": "{colors.gray.7}",
                "_dark": "{colors.gray.7}",
              },
            },
            "muted": {
              "value": {
                "_light": "{colors.gray.6}",
                "_dark": "{colors.gray.6}",
              },
            },
            "subtle": {
              "value": {
                "_light": "{colors.gray.4}",
                "_dark": "{colors.gray.4}",
              },
            },
            "disabled": {
              "value": {
                "_light": "{colors.gray.5}",
                "_dark": "{colors.gray.5}",
              },
            },
            "outline": {
              "value": {
                "_light": "{colors.gray.a9}",
                "_dark": "{colors.gray.a9}",
              },
            },
            "error": {
              "value": {
                "_light": "{colors.red.9}",
                "_dark": "{colors.red.9}",
              },
            },
          },
          "red": {
            "1": {
              "value": {
                "_light": "{colors.red.light.1}",
                "_dark": "{colors.red.dark.1}",
              },
            },
            "2": {
              "value": {
                "_light": "{colors.red.light.2}",
                "_dark": "{colors.red.dark.2}",
              },
            },
            "3": {
              "value": {
                "_light": "{colors.red.light.3}",
                "_dark": "{colors.red.dark.3}",
              },
            },
            "4": {
              "value": {
                "_light": "{colors.red.light.4}",
                "_dark": "{colors.red.dark.4}",
              },
            },
            "5": {
              "value": {
                "_light": "{colors.red.light.5}",
                "_dark": "{colors.red.dark.5}",
              },
            },
            "6": {
              "value": {
                "_light": "{colors.red.light.6}",
                "_dark": "{colors.red.dark.6}",
              },
            },
            "7": {
              "value": {
                "_light": "{colors.red.light.7}",
                "_dark": "{colors.red.dark.7}",
              },
            },
            "8": {
              "value": {
                "_light": "{colors.red.light.8}",
                "_dark": "{colors.red.dark.8}",
              },
            },
            "9": {
              "value": {
                "_light": "{colors.red.light.9}",
                "_dark": "{colors.red.dark.9}",
              },
            },
            "10": {
              "value": {
                "_light": "{colors.red.light.10}",
                "_dark": "{colors.red.dark.10}",
              },
            },
            "11": {
              "value": {
                "_light": "{colors.red.light.11}",
                "_dark": "{colors.red.dark.11}",
              },
            },
            "12": {
              "value": {
                "_light": "{colors.red.light.12}",
                "_dark": "{colors.red.dark.12}",
              },
            },
            "a1": {
              "value": {
                "_light": "{colors.red.light.a1}",
                "_dark": "{colors.red.dark.a1}",
              },
            },
            "a2": {
              "value": {
                "_light": "{colors.red.light.a2}",
                "_dark": "{colors.red.dark.a2}",
              },
            },
            "a3": {
              "value": {
                "_light": "{colors.red.light.a3}",
                "_dark": "{colors.red.dark.a3}",
              },
            },
            "a4": {
              "value": {
                "_light": "{colors.red.light.a4}",
                "_dark": "{colors.red.dark.a4}",
              },
            },
            "a5": {
              "value": {
                "_light": "{colors.red.light.a5}",
                "_dark": "{colors.red.dark.a5}",
              },
            },
            "a6": {
              "value": {
                "_light": "{colors.red.light.a6}",
                "_dark": "{colors.red.dark.a6}",
              },
            },
            "a7": {
              "value": {
                "_light": "{colors.red.light.a7}",
                "_dark": "{colors.red.dark.a7}",
              },
            },
            "a8": {
              "value": {
                "_light": "{colors.red.light.a8}",
                "_dark": "{colors.red.dark.a8}",
              },
            },
            "a9": {
              "value": {
                "_light": "{colors.red.light.a9}",
                "_dark": "{colors.red.dark.a9}",
              },
            },
            "a10": {
              "value": {
                "_light": "{colors.red.light.a10}",
                "_dark": "{colors.red.dark.a10}",
              },
            },
            "a11": {
              "value": {
                "_light": "{colors.red.light.a11}",
                "_dark": "{colors.red.dark.a11}",
              },
            },
            "a12": {
              "value": {
                "_light": "{colors.red.light.a12}",
                "_dark": "{colors.red.dark.a12}",
              },
            },
            "default": {
              "value": {
                "_light": "{colors.red.light.9}",
                "_dark": "{colors.red.dark.9}",
              },
            },
            "emphasized": {
              "value": {
                "_light": "{colors.red.light.10}",
                "_dark": "{colors.red.dark.10}",
              },
            },
            "fg": {
              "value": {
                "_light": "white",
                "_dark": "white",
              },
            },
            "text": {
              "value": {
                "_light": "{colors.red.light.a11}",
                "_dark": "{colors.red.dark.a11}",
              },
            },
          },
          "gray": {
            "1": {
              "value": {
                "_light": "{colors.gray.light.1}",
                "_dark": "{colors.gray.dark.1}",
              },
            },
            "2": {
              "value": {
                "_light": "{colors.gray.light.2}",
                "_dark": "{colors.gray.dark.2}",
              },
            },
            "3": {
              "value": {
                "_light": "{colors.gray.light.3}",
                "_dark": "{colors.gray.dark.3}",
              },
            },
            "4": {
              "value": {
                "_light": "{colors.gray.light.4}",
                "_dark": "{colors.gray.dark.4}",
              },
            },
            "5": {
              "value": {
                "_light": "{colors.gray.light.5}",
                "_dark": "{colors.gray.dark.5}",
              },
            },
            "6": {
              "value": {
                "_light": "{colors.gray.light.6}",
                "_dark": "{colors.gray.dark.6}",
              },
            },
            "7": {
              "value": {
                "_light": "{colors.gray.light.7}",
                "_dark": "{colors.gray.dark.7}",
              },
            },
            "8": {
              "value": {
                "_light": "{colors.gray.light.8}",
                "_dark": "{colors.gray.dark.8}",
              },
            },
            "9": {
              "value": {
                "_light": "{colors.gray.light.9}",
                "_dark": "{colors.gray.dark.9}",
              },
            },
            "10": {
              "value": {
                "_light": "{colors.gray.light.10}",
                "_dark": "{colors.gray.dark.10}",
              },
            },
            "11": {
              "value": {
                "_light": "{colors.gray.light.11}",
                "_dark": "{colors.gray.dark.11}",
              },
            },
            "12": {
              "value": {
                "_light": "{colors.gray.light.12}",
                "_dark": "{colors.gray.dark.12}",
              },
            },
            "a1": {
              "value": {
                "_light": "{colors.gray.light.a1}",
                "_dark": "{colors.gray.dark.a1}",
              },
            },
            "a2": {
              "value": {
                "_light": "{colors.gray.light.a2}",
                "_dark": "{colors.gray.dark.a2}",
              },
            },
            "a3": {
              "value": {
                "_light": "{colors.gray.light.a3}",
                "_dark": "{colors.gray.dark.a3}",
              },
            },
            "a4": {
              "value": {
                "_light": "{colors.gray.light.a4}",
                "_dark": "{colors.gray.dark.a4}",
              },
            },
            "a5": {
              "value": {
                "_light": "{colors.gray.light.a5}",
                "_dark": "{colors.gray.dark.a5}",
              },
            },
            "a6": {
              "value": {
                "_light": "{colors.gray.light.a6}",
                "_dark": "{colors.gray.dark.a6}",
              },
            },
            "a7": {
              "value": {
                "_light": "{colors.gray.light.a7}",
                "_dark": "{colors.gray.dark.a7}",
              },
            },
            "a8": {
              "value": {
                "_light": "{colors.gray.light.a8}",
                "_dark": "{colors.gray.dark.a8}",
              },
            },
            "a9": {
              "value": {
                "_light": "{colors.gray.light.a9}",
                "_dark": "{colors.gray.dark.a9}",
              },
            },
            "a10": {
              "value": {
                "_light": "{colors.gray.light.a10}",
                "_dark": "{colors.gray.dark.a10}",
              },
            },
            "a11": {
              "value": {
                "_light": "{colors.gray.light.a11}",
                "_dark": "{colors.gray.dark.a11}",
              },
            },
            "a12": {
              "value": {
                "_light": "{colors.gray.light.a12}",
                "_dark": "{colors.gray.dark.a12}",
              },
            },
            "default": {
              "value": {
                "_light": "{colors.gray.light.9}",
                "_dark": "{colors.gray.dark.9}",
              },
            },
            "emphasized": {
              "value": {
                "_light": "{colors.gray.light.10}",
                "_dark": "{colors.gray.dark.10}",
              },
            },
            "fg": {
              "value": {
                "_light": "white",
                "_dark": "white",
              },
            },
            "text": {
              "value": {
                "_light": "{colors.gray.light.12}",
                "_dark": "{colors.gray.dark.12}",
              },
            },
          },
          "brandcyan": {
            "1": {
              "value": {
                "_light": "{colors.brandcyan.light.1}",
                "_dark": "{colors.brandcyan.dark.1}",
              },
            },
            "2": {
              "value": {
                "_light": "{colors.brandcyan.light.2}",
                "_dark": "{colors.brandcyan.dark.2}",
              },
            },
            "3": {
              "value": {
                "_light": "{colors.brandcyan.light.3}",
                "_dark": "{colors.brandcyan.dark.3}",
              },
            },
            "4": {
              "value": {
                "_light": "{colors.brandcyan.light.4}",
                "_dark": "{colors.brandcyan.dark.4}",
              },
            },
            "5": {
              "value": {
                "_light": "{colors.brandcyan.light.5}",
                "_dark": "{colors.brandcyan.dark.5}",
              },
            },
            "6": {
              "value": {
                "_light": "{colors.brandcyan.light.6}",
                "_dark": "{colors.brandcyan.dark.6}",
              },
            },
            "7": {
              "value": {
                "_light": "{colors.brandcyan.light.7}",
                "_dark": "{colors.brandcyan.dark.7}",
              },
            },
            "8": {
              "value": {
                "_light": "{colors.brandcyan.light.8}",
                "_dark": "{colors.brandcyan.dark.8}",
              },
            },
            "9": {
              "value": {
                "_light": "{colors.brandcyan.light.9}",
                "_dark": "{colors.brandcyan.dark.9}",
              },
            },
            "10": {
              "value": {
                "_light": "{colors.brandcyan.light.10}",
                "_dark": "{colors.brandcyan.dark.10}",
              },
            },
            "11": {
              "value": {
                "_light": "{colors.brandcyan.light.11}",
                "_dark": "{colors.brandcyan.dark.11}",
              },
            },
            "12": {
              "value": {
                "_light": "{colors.brandcyan.light.12}",
                "_dark": "{colors.brandcyan.dark.12}",
              },
            },
            "a1": {
              "value": {
                "_light": "{colors.brandcyan.light.a1}",
                "_dark": "{colors.brandcyan.dark.a1}",
              },
            },
            "a2": {
              "value": {
                "_light": "{colors.brandcyan.light.a2}",
                "_dark": "{colors.brandcyan.dark.a2}",
              },
            },
            "a3": {
              "value": {
                "_light": "{colors.brandcyan.light.a3}",
                "_dark": "{colors.brandcyan.dark.a3}",
              },
            },
            "a4": {
              "value": {
                "_light": "{colors.brandcyan.light.a4}",
                "_dark": "{colors.brandcyan.dark.a4}",
              },
            },
            "a5": {
              "value": {
                "_light": "{colors.brandcyan.light.a5}",
                "_dark": "{colors.brandcyan.dark.a5}",
              },
            },
            "a6": {
              "value": {
                "_light": "{colors.brandcyan.light.a6}",
                "_dark": "{colors.brandcyan.dark.a6}",
              },
            },
            "a7": {
              "value": {
                "_light": "{colors.brandcyan.light.a7}",
                "_dark": "{colors.brandcyan.dark.a7}",
              },
            },
            "a8": {
              "value": {
                "_light": "{colors.brandcyan.light.a8}",
                "_dark": "{colors.brandcyan.dark.a8}",
              },
            },
            "a9": {
              "value": {
                "_light": "{colors.brandcyan.light.a9}",
                "_dark": "{colors.brandcyan.dark.a9}",
              },
            },
            "a10": {
              "value": {
                "_light": "{colors.brandcyan.light.a10}",
                "_dark": "{colors.brandcyan.dark.a10}",
              },
            },
            "a11": {
              "value": {
                "_light": "{colors.brandcyan.light.a11}",
                "_dark": "{colors.brandcyan.dark.a11}",
              },
            },
            "a12": {
              "value": {
                "_light": "{colors.brandcyan.light.a12}",
                "_dark": "{colors.brandcyan.dark.a12}",
              },
            },
            "default": {
              "value": {
                "_light": "{colors.brandcyan.light.9}",
                "_dark": "{colors.brandcyan.dark.9}",
              },
            },
            "emphasized": {
              "value": {
                "_light": "{colors.brandcyan.light.10}",
                "_dark": "{colors.brandcyan.dark.10}",
              },
            },
            "fg": {
              "value": {
                "_light": "{colors.brandcyan.dark.1}",
                "_dark": "{colors.brandcyan.dark.1}",
              },
            },
            "text": {
              "value": {
                "_light": "{colors.brandcyan.light.11}",
                "_dark": "{colors.brandcyan.dark.11}",
              },
            },
          },
        },
        "shadows": {
          "xs": {
            "value": {
              "_light":
                "0px 1px 2px {colors.gray.a5}, 0px 0px 1px {colors.gray.a7}",
              "_dark":
                "0px 1px 1px {colors.black.a12}, 0px 0px 1px inset {colors.gray.a7}",
            },
          },
          "sm": {
            "value": {
              "_light":
                "0px 2px 4px {colors.gray.a3}, 0px 0px 1px {colors.gray.a7}",
              "_dark":
                "0px 2px 4px {colors.black.a10}, 0px 0px 1px inset {colors.gray.a7}",
            },
          },
          "md": {
            "value": {
              "_light":
                "0px 4px 8px {colors.gray.a3}, 0px 0px 1px {colors.gray.a7}",
              "_dark":
                "0px 4px 8px {colors.black.a10}, 0px 0px 1px inset {colors.gray.a7}",
            },
          },
          "lg": {
            "value": {
              "_light":
                "0px 8px 16px {colors.gray.a3}, 0px 0px 1px {colors.gray.a7}",
              "_dark":
                "0px 8px 16px {colors.black.a10}, 0px 0px 1px inset {colors.gray.a7}",
            },
          },
          "xl": {
            "value": {
              "_light":
                "0px 16px 24px {colors.gray.a3}, 0px 0px 1px {colors.gray.a7}",
              "_dark":
                "0px 16px 24px {colors.black.a10}, 0px 0px 1px inset {colors.gray.a7}",
            },
          },
          "2xl": {
            "value": {
              "_light":
                "0px 24px 40px {colors.gray.a3}, 0px 0px 1px {colors.gray.a7}",
              "_dark":
                "0px 24px 40px {colors.black.a10}, 0px 0px 1px inset {colors.gray.a7}",
            },
          },
        },
        "radii": {
          "l1": {
            "value": "{radii.sm}",
          },
          "l2": {
            "value": "{radii.md}",
          },
          "l3": {
            "value": "{radii.lg}",
          },
        },
      },
    },
  },
} as unknown as Preset;

export default parkLegacyPreset;
