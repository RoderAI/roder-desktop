import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SidebarAccountTriggerContent } from "../src/components/sidebar-account-menu";
import type { CodexAccountSnapshot } from "../src/types/roder";

test("sidebar account trigger shows a loading skeleton before account state resolves", () => {
  const html = renderToStaticMarkup(React.createElement(SidebarAccountTriggerContent, { account: undefined }));

  expect(html).toContain("Loading Codex account");
  expect(html).toContain("size-7");
  expect(html).not.toContain("Sign in to Codex");
  expect(html).not.toContain("Connect provider");
});

test("sidebar account trigger shows the sign-in prompt after an unauthenticated snapshot resolves", () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarAccountTriggerContent, { account: unauthenticatedAccount() }),
  );

  expect(html).toContain("Sign in to Codex");
  expect(html).toContain("Connect provider");
});

test("sidebar account trigger omits provider status after an authenticated snapshot resolves", () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarAccountTriggerContent, {
      account: {
        ...unauthenticatedAccount(),
        codexSignedIn: true,
        roderSignedIn: true,
        displayName: "Ada Lovelace",
        accountId: "acct_123",
      },
    }),
  );

  expect(html).toContain("Ada Lovelace");
  expect(html).toContain("size-7");
  expect(html).not.toContain("Roder connected");
});

function unauthenticatedAccount(): CodexAccountSnapshot {
  return {
    signedIn: false,
    codexSignedIn: false,
    roderSignedIn: false,
    displayName: null,
    planType: null,
    accountId: null,
    limits: null,
    loginPending: false,
  };
}
