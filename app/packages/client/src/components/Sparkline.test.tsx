import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { Sparkline } from "./Sparkline.tsx";

describe("Sparkline", () => {
  const lineOf = (data: number[]) => {
    const { container } = render(() => <Sparkline data={data} />);
    const line = container.querySelector("polyline");
    return {
      points: line?.getAttribute("points"),
      dashed: line?.getAttribute("stroke-dasharray") != null,
    };
  };

  it("draws a dashed flat line on the mid baseline when the series is all zeros", () => {
    // Idle instance: no shape to plot, so it sits flat on the mid baseline
    // y = H/2 (9) — level with the row's status dot — dashed to read as "no data".
    const { points, dashed } = lineOf([0, 0, 0, 0]);
    expect(points).toBe("0,9 40,9");
    expect(dashed).toBe(true);
  });

  it("draws a dashed mid baseline for a single-point (or empty) series", () => {
    expect(lineOf([5])).toEqual({ points: "0,9 40,9", dashed: true });
    expect(lineOf([])).toEqual({ points: "0,9 40,9", dashed: true });
  });

  it("centres the waveform on the mid baseline, solid line", () => {
    // Two points [0, 8]: mean 4 sits on MID (9); the low deviates down to y=17
    // and the high up to y=1 (1px inset), centring the line on the status dot.
    const { points, dashed } = lineOf([0, 8]);
    expect(points).toBe("0.0,17.0 40.0,1.0");
    expect(dashed).toBe(false);
  });
});
