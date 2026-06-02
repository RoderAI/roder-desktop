import { expect, test } from "vitest";
import { rendererZoomFactor, scaleRendererBounds } from "../electron/main/renderer-scale";

test("renderer uses natural Electron zoom", () => {
  expect(rendererZoomFactor).toBe(1);
});

test("browser overlay bounds line up with renderer coordinates", () => {
  expect(scaleRendererBounds({ x: 12.4, y: 51.6, width: 420.2, height: 240.8 })).toEqual({
    x: 12,
    y: 52,
    width: 420,
    height: 241,
  });
});

test("browser overlay fallback stays usable", () => {
  expect(scaleRendererBounds()).toEqual({
    x: 0,
    y: 52,
    width: 720,
    height: 640,
  });
});
