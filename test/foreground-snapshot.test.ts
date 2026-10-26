import { expect, test } from "vitest";
import { createForegroundSnapshot } from "../src/lib/foreground-snapshot";

test("background updates do not derive or render until the window returns", () => {
  let derivations = 0;
  const select = createForegroundSnapshot((state: { messages: string[] }) => {
    derivations++;
    return state.messages;
  }, [] as string[]);
  const first = ["one"];
  const latest = ["one", "two"];
  expect(select({ messages: first }, true)).toBe(first);
  expect(select({ messages: latest }, false)).toBe(first);
  expect(select({ messages: latest }, false)).toBe(first);
  expect(derivations).toBe(1);
  expect(select({ messages: latest }, true)).toBe(latest);
  expect(derivations).toBe(2);
});
