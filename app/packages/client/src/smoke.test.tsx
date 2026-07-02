import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";

// Smoke test: proves the Vitest + solid + jsdom pipeline renders a reactive
// Solid component into the DOM. If this fails, the runner itself is broken.
describe("client test runner", () => {
  it("renders a trivial Solid component", () => {
    const { getByText } = render(() => <p>p0rt1on</p>);
    expect(getByText("p0rt1on")).toBeInTheDocument();
  });
});
