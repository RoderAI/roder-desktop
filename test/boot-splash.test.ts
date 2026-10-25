import { afterEach, expect, test, vi } from "vitest";
import { dismissBootSplash } from "../src/lib/boot-splash";

afterEach(() => {
  vi.useRealTimers();
});

function fakeDocument(splashPresent: boolean) {
  const classes = new Set<string>();
  const splash = {
    classList: {
      add: (name: string) => classes.add(name),
      contains: (name: string) => classes.has(name),
    },
    remove: vi.fn<() => void>(),
  };
  const doc = {
    getElementById: (id: string) => (splashPresent && id === "boot-splash" ? splash : null),
  };
  return { splash, doc: doc as unknown as Pick<Document, "getElementById"> };
}

test("fades the boot splash out and removes it once the app has hydrated", () => {
  vi.useFakeTimers();
  const { splash, doc } = fakeDocument(true);

  dismissBootSplash(doc);

  expect(splash.classList.contains("is-leaving")).toBe(true);
  expect(splash.remove).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(splash.remove).toHaveBeenCalledTimes(1);
});

test("a repeated dismissal does not schedule a second removal", () => {
  vi.useFakeTimers();
  const { splash, doc } = fakeDocument(true);

  dismissBootSplash(doc);
  dismissBootSplash(doc);
  vi.advanceTimersByTime(200);

  expect(splash.remove).toHaveBeenCalledTimes(1);
});

test("does nothing when the splash is already gone", () => {
  const { doc } = fakeDocument(false);

  expect(() => dismissBootSplash(doc)).not.toThrow();
});
