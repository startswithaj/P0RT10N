// Ambient module declarations for Vite's non-code imports so `tsc --noEmit`
// (the client typecheck gate) can resolve them. Vite handles these at build
// time; TypeScript needs the shims to not error on the side-effect import.
declare module "*.css";
