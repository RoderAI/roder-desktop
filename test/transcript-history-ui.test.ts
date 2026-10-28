import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { Transcript } from "../src/components/transcript";

test("older history has an explicit fallback control without eagerly fetching on render", () => {
  const load = vi.fn<() => Promise<void>>(async () => {});
  const html = renderToStaticMarkup(
    createElement(Transcript, {
      messages: [],
      followSignal: 0,
      hasOlderHistory: true,
      historyCursor: "older",
      onLoadOlderHistory: load,
    }),
  );
  expect(html).toContain("Load older messages");
  expect(load).not.toHaveBeenCalled();
});

test("initial loading and older-page errors remain visible and retryable", () => {
  const loading = renderToStaticMarkup(
    createElement(Transcript, {
      messages: [],
      followSignal: 0,
      historyLoading: true,
    }),
  );
  expect(loading).toContain("Loading recent messages...");
  const error = renderToStaticMarkup(
    createElement(Transcript, {
      messages: [],
      followSignal: 0,
      hasOlderHistory: true,
      historyError: "Connection failed",
    }),
  );
  expect(error).toContain('role="alert"');
  expect(error).toContain("Connection failed");
  expect(error).toContain("Retry");
  expect(error).toContain("Reload recent");
});
