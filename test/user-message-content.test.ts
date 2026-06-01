import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { UserMessageContent } from "../src/components/user-message-content";

test("user message images render before the prompt text", () => {
  const html = renderToStaticMarkup(
    React.createElement(UserMessageContent, {
      images: [{ imageUrl: "data:image/png;base64,YWJj" }],
      skills: [],
      text: "clean this sketch up",
    }),
  );

  expect(html.indexOf('src="data:image/png;base64,YWJj"')).toBeGreaterThanOrEqual(0);
  expect(html.indexOf("clean this sketch up")).toBeGreaterThan(html.indexOf('src="data:image/png;base64,YWJj"'));
});
