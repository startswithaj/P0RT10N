// These ambient module declarations let `tsc --noEmit` resolve Vite's non-code imports,
// which Vite itself handles at build time but TypeScript can't without a shim.
declare module "*.css";

// This is the demo-build flag: Vite statically replaces `import.meta.env.VITE_DEMO_MODE`.
// Do not alias `import.meta` elsewhere, since that breaks the static replacement.
interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
