import { useCallback } from "react";

type ResizeUpdate = (startWidth: number, deltaX: number) => void;

export function useHorizontalResize(
  startWidth: number,
  update: ResizeUpdate,
): (event: React.PointerEvent<HTMLDivElement>) => void {
  return useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      beginHorizontalResize(event, startWidth, update);
    },
    [startWidth, update],
  );
}

function beginHorizontalResize(
  event: React.PointerEvent<HTMLDivElement>,
  startWidth: number,
  update: ResizeUpdate,
): void {
  event.preventDefault();
  const startX = event.clientX;

  function onPointerMove(moveEvent: PointerEvent): void {
    update(startWidth, moveEvent.clientX - startX);
  }

  function onPointerUp(): void {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
