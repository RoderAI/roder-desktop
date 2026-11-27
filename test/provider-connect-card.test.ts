import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ProviderConnectCard } from "../src/components/providers/provider-connect-card";
import type { ProviderDescriptor } from "../src/types/roder";

function renderCard(provider: ProviderDescriptor, ready: boolean): string {
  return renderToStaticMarkup(
    React.createElement(ProviderConnectCard, {
      provider,
      ready,
      claudeCli: null,
      onRecheckClaudeCli: async () => {},
      onError: () => {},
    }),
  );
}

test("ChatGPT sign-out is available only when connected", () => {
  const provider: ProviderDescriptor = { id: "codex", name: "ChatGPT", authType: "oauth" };
  expect(renderCard(provider, true)).toContain(">Sign out</button>");
  expect(renderCard(provider, false)).not.toContain(">Sign out</button>");
});

test("other OAuth providers do not offer ChatGPT sign-out", () => {
  expect(renderCard({ id: "supergrok", name: "SuperGrok", authType: "oauth" }, true)).not.toContain(
    ">Sign out</button>",
  );
});
