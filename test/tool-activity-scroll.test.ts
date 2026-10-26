import { expect, test } from "vitest";
import { followToolActivity, visibleToolActivityCount } from "../src/lib/tool-activity-scroll";

test("shows the last five rows and keeps following until the user scrolls back", () => {
  let position = 0;
  let height = 240;
  let onScroll = () => {};
  let resize = () => {};
  let disconnected = false;
  const viewport = {
    get scrollHeight() {
      return height;
    },
    clientHeight: visibleToolActivityCount * 24,
    get scrollTop() {
      return position;
    },
    set scrollTop(value: number) {
      position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    },
    addEventListener: (_: string, listener: () => void) => {
      onScroll = listener;
    },
    removeEventListener: () => {
      onScroll = () => {};
    },
  } as unknown as HTMLElement;
  const cleanup = followToolActivity(viewport, {} as HTMLElement, (listener) => {
    resize = listener;
    return {
      observe: () => {},
      disconnect: () => {
        disconnected = true;
      },
    };
  });
  expect(visibleToolActivityCount).toBe(5);
  expect(viewport.scrollTop).toBe(120);
  viewport.scrollTop = 24;
  onScroll();
  height = 288;
  resize();
  expect(viewport.scrollTop).toBe(24);
  viewport.scrollTop = 168;
  onScroll();
  height = 312;
  resize();
  expect(viewport.scrollTop).toBe(192);
  cleanup();
  expect(disconnected).toBe(true);
});
