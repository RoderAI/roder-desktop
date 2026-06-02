import type { Rectangle } from "electron";

export const rendererZoomFactor = 1;

export function scaleRendererBounds(bounds?: Rectangle): Rectangle {
  const fallback = { x: 0, y: 52, width: 720, height: 640 };
  const source = bounds ?? fallback;
  return {
    x: Math.round(source.x * rendererZoomFactor),
    y: Math.round(source.y * rendererZoomFactor),
    width: Math.max(100, Math.round(source.width * rendererZoomFactor)),
    height: Math.max(100, Math.round(source.height * rendererZoomFactor)),
  };
}
