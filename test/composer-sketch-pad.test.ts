import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ComposerSketchPad } from "../src/components/composer-sketch-pad";

test("composer sketch pad renders an inline drawing surface with sketch actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(ComposerSketchPad, {
      onAttach: () => undefined,
      onClose: () => undefined,
    }),
  );

  expect(html).toContain("Sketch input");
  expect(html).toContain("Use sketch");
  expect(html).toContain("Clear");
});

test("composer sketch pad exposes marker colors and paste-ready canvas", () => {
  const html = renderToStaticMarkup(
    React.createElement(ComposerSketchPad, {
      onAttach: () => undefined,
      onClose: () => undefined,
    }),
  );

  expect(html).toContain('aria-label="Use marker color #18181b"');
  expect(html).toContain('aria-label="Use marker color #f97316"');
  expect(html).toContain('aria-label="Sketch input, paste images to annotate"');
  expect(html).toContain('tabindex="0"');
});
