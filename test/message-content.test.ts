import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessageContent } from "../src/components/message-content";
import { renderTextWithSkillTokens } from "../src/components/skill-token-pill";
import type { SkillDescriptor } from "../src/types/roder";

test("renders markdown links without harden origin errors", () => {
  expect(() =>
    renderToStaticMarkup(React.createElement(MessageContent, { text: "[Docs](https://example.com/docs)" })),
  ).not.toThrow();
});

test("renders known skill references as pills in plain text", () => {
  const html = renderToStaticMarkup(
    React.createElement(React.Fragment, null, renderTextWithSkillTokens("tell me about $interface-craft", [skill()])),
  );

  expect(html).toContain('data-skill-token="interface-craft"');
  expect(html).toContain("Interface Craft");
});

test("renders known skill references as pills in markdown messages", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageContent, { text: "Use $interface-craft for polish.", skills: [skill()] }),
  );

  expect(html).toContain('data-skill-token="interface-craft"');
  expect(html).toContain("Interface Craft");
});

test("renders exact skill references in inline code as pills", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageContent, {
      text: "`$commit` is useful, but `$PATH` stays code.",
      skills: [skill({ name: "commit" })],
    }),
  );

  expect(html).toContain('data-skill-token="commit"');
  expect(html).toContain("Commit");
  expect(html).toContain("$PATH");
  expect(html).toContain("message-inline-code");
});

test("leaves unknown dollar tokens as text in messages", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageContent, { text: "Keep $PATH literal.", skills: [skill()] }),
  );

  expect(html).toContain("$PATH");
  expect(html).not.toContain("data-skill-token");
});

test("does not render Streamdown's streaming caret marker", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageContent, { text: "Streaming response", isStreaming: true }),
  );

  expect(html).not.toContain("--streamdown-caret");
  expect(html).not.toContain("▋");
});

function skill(patch: Partial<SkillDescriptor> = {}): SkillDescriptor {
  return {
    id: patch.id ?? `user:${patch.name ?? "interface-craft"}`,
    name: patch.name ?? "interface-craft",
    canonicalPath: patch.canonicalPath ?? `/skills/${patch.name ?? "interface-craft"}/SKILL.md`,
    source: "user",
    exposure: "direct_only",
    activation: "enabled",
    description: "Interface helpers.",
    experimental: false,
    diagnostics: [],
  };
}
