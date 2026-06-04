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
): (event: React.PointerEvent<HTMLElement>) => void {
  const onActiveChange = options?.onActiveChange;
  const onCommit = options?.onCommit;
  return useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      beginHorizontalResize(event, startWidth, update, { onActiveChange, onCommit });
    },
    [onActiveChange, onCommit, startWidth, update],
  );
}

function beginHorizontalResize(
  event: React.PointerEvent<HTMLElement>,
  startWidth: number,
  update: ResizeUpdate,
  options: ResizeOptions,
): void {
  event.preventDefault();
  event.stopPropagation();
  const resizeHandle = event.currentTarget;
  const startX = event.clientX;
  const pointerId = event.pointerId;
  let lastDeltaX = 0;
  let scheduledDeltaX = 0;
  let frameId: number | null = null;
  options.onActiveChange?.(true);
  try {
    resizeHandle.setPointerCapture(pointerId);
  } catch {
    // Some embedded/native surfaces may not support capture; document listeners below still handle normal drags.
  }

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
    try {
      if (resizeHandle.hasPointerCapture(pointerId)) {
        resizeHandle.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore capture release failures from browsers/native shells that do not support it.
    }
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", endResize, true);
    document.removeEventListener("pointercancel", endResize, true);
  }

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", endResize, { capture: true, once: true });
  document.addEventListener("pointercancel", endResize, { capture: true, once: true });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
