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

  it("draws a dashed flat baseline when the series is all zeros", () => {
    // Idle instance: no shape to plot, so it sits flat at y = H-1 (17), dashed so
    // it reads as "no data" rather than a real flatline.
    const { points, dashed } = lineOf([0, 0, 0, 0]);
    expect(points).toBe("0,17 40,17");
    expect(dashed).toBe(true);
  });

  it("draws a dashed baseline for a single-point (or empty) series", () => {
    expect(lineOf([5])).toEqual({ points: "0,17 40,17", dashed: true });
    expect(lineOf([])).toEqual({ points: "0,17 40,17", dashed: true });
  });

  it("scales the peak to the top inset and zeros to the baseline, solid line", () => {
    // Two points: the peak maps to y=1 (1px top inset), zero to y=17 (baseline);
    // x spans the full 40px width, and a real series is solid (not dashed).
    const { points, dashed } = lineOf([0, 8]);
    expect(points).toBe("0.0,17.0 40.0,1.0");
    expect(dashed).toBe(false);
  });
});
