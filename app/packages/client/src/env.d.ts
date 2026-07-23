// Ambient module declarations for Vite's non-code imports so `tsc --noEmit`
// (the client typecheck gate) can resolve them. Vite handles these at build
// time; TypeScript needs the shims to not error on the side-effect import.
declare module "*.css";

// The demo-build flag; Vite statically replaces `import.meta.env.VITE_DEMO_MODE`.
// Do NOT alias `import.meta` elsewhere — that breaks the static replacement.
interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
