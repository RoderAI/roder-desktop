import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { expect, test } from "vitest";
import { ScrollArea, ScrollBar } from "../src/components/ui/scroll-area";

test("scroll area uses the primitive viewport and preserves viewport attributes and content", () => {
  const html = renderToStaticMarkup(
    createElement(
      ScrollArea,
      {
        className: "h-full",
        viewportClassName: "transcript-viewport",
        viewportProps: { "aria-label": "Conversations", tabIndex: 0, className: "px-2" },
      },
      createElement("p", null, "Conversation content"),
    ),
  );
  expect(html).toContain('data-slot="scroll-area"');
  expect(html).toContain('data-slot="scroll-area-viewport"');
  expect(html).toContain('aria-label="Conversations"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("transcript-viewport px-2");
  expect(html).toContain("Conversation content");
  // Base UI suppresses native scrollbars rather than painting a second scrollbar.
  expect(html).toContain("scrollbar-width");
});

test.each(["vertical", "horizontal"] as const)(
  "custom %s scrollbar has a draggable thumb and fades when idle",
  (orientation) => {
    const html = renderToStaticMarkup(
      createElement(ScrollAreaPrimitive.Root, null, createElement(ScrollBar, { orientation, keepMounted: true })),
    );
    expect(html).toContain('data-slot="scroll-area-scrollbar"');
    expect(html).toContain(`data-orientation="${orientation}"`);
    expect(html).toContain('data-slot="scroll-area-thumb"');
    expect(html).toContain("opacity-0");
    expect(html).toContain("data-hovering:opacity-100");
    expect(html).toContain("data-scrolling:opacity-100");
    expect(html).toContain("group-focus-within/scroll-area:opacity-100");
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).not.toContain("pointer-events-none");
  },
);
