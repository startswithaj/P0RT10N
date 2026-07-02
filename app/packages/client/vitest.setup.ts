// Global test setup: jest-dom matchers (toBeInTheDocument, toBeDisabled, …) and
// automatic DOM teardown between tests so rendered components don't leak.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@solidjs/testing-library";

afterEach(() => {
  cleanup();
});
