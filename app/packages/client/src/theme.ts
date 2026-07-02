import { createSignal } from "solid-js";

// Light/dark theme. Park UI's semantic tokens flip on the `.dark` class on
// <html>, so toggling that class is all it takes. Preference persists; initial
// value follows the saved choice or the OS preference.
export type Theme = "light" | "dark";

const STORAGE_KEY = "p0rt1on-theme";

function initialTheme(): Theme {
  // Brand is dark-first: default to dark unless the user explicitly chose light.
  const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

function apply(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  globalThis.localStorage?.setItem(STORAGE_KEY, t);
}

const [theme, setTheme] = createSignal<Theme>(initialTheme());
apply(theme()); // sync the class on first load

export { theme };

export function setThemeValue(next: Theme): void {
  setTheme(next);
  apply(next);
}

export function toggleTheme(): void {
  setThemeValue(theme() === "dark" ? "light" : "dark");
}
