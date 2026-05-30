import { useCallback } from "react";

type ResizeUpdate = (startWidth: number, deltaX: number) => void;
type ResizeOptions = {
  onActiveChange?: (active: boolean) => void;
  onCommit?: ResizeUpdate;
};

export function useHorizontalResize(
  startWidth: number,
  update: ResizeUpdate,
  options?: ResizeOptions,
): (event: React.PointerEvent<HTMLDivElement>) => void {
  const onActiveChange = options?.onActiveChange;
  const onCommit = options?.onCommit;
  return useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      beginHorizontalResize(event, startWidth, update, { onActiveChange, onCommit });
    },
    [onActiveChange, onCommit, startWidth, update],
  );
}

function beginHorizontalResize(
  event: React.PointerEvent<HTMLDivElement>,
  startWidth: number,
  update: ResizeUpdate,
  options: ResizeOptions,
): void {
  event.preventDefault();
  const startX = event.clientX;
  let lastDeltaX = 0;
  let scheduledDeltaX = 0;
  let frameId: number | null = null;
  options.onActiveChange?.(true);

  function runUpdate(): void {
    frameId = null;
    update(startWidth, scheduledDeltaX);
  }

  function onPointerMove(moveEvent: PointerEvent): void {
    lastDeltaX = moveEvent.clientX - startX;
    scheduledDeltaX = lastDeltaX;
    if (frameId === null) {
      frameId = window.requestAnimationFrame(runUpdate);
    }
  }

  function endResize(): void {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
      update(startWidth, lastDeltaX);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    options.onActiveChange?.(false);
    options.onCommit?.(startWidth, lastDeltaX);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
  }

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", endResize, { once: true });
  window.addEventListener("pointercancel", endResize, { once: true });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
