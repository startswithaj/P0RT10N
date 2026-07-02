import { render } from "solid-js/web";
import { QueryClientProvider } from "@tanstack/solid-query";
import "./index.css";
import { App } from "./App.tsx";
import { queryClient } from "./trpc.ts";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  ),
  root,
);
