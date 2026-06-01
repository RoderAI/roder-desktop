import { expect, test } from "vitest";
import { fitCanvasImageRect, hasCanvasContent } from "../src/lib/canvas-surface";

test("canvas content detection ignores empty strokes and sees meaningful marks", () => {
  expect(hasCanvasContent({ images: [], shapes: [], strokes: [] })).toBe(false);
  expect(
    hasCanvasContent({
      images: [],
      shapes: [],
      strokes: [{ id: "stroke-1", color: "#18181b", width: 5, order: 1, points: [] }],
    }),
  ).toBe(false);
  expect(
    hasCanvasContent({
      images: [],
      shapes: [],
      strokes: [{ id: "stroke-1", color: "#18181b", width: 5, order: 1, points: [{ x: 1, y: 1 }] }],
    }),
  ).toBe(true);
});

test("canvas image placement fits large pasted images inside a surface", () => {
  const rect = fitCanvasImageRect({
    imageWidth: 1600,
    imageHeight: 900,
    surfaceWidth: 400,
    surfaceHeight: 180,
  });

  expect(rect.width).toBeLessThanOrEqual(352);
  expect(rect.height).toBeLessThanOrEqual(144);
  expect(rect.x).toBeGreaterThanOrEqual(12);
  expect(rect.y).toBeGreaterThanOrEqual(12);
});
