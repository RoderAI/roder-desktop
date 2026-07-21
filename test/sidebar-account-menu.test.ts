import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SidebarAccountTriggerContent } from "../src/components/sidebar-account-menu";
import type { CodexAccountSnapshot } from "../src/types/roder";

test("sidebar account trigger shows a loading skeleton before account state resolves", () => {
  const html = renderToStaticMarkup(React.createElement(SidebarAccountTriggerContent, { account: undefined }));

  expect(html).toContain("Loading Codex account");
  expect(html).not.toContain("Settings");
  expect(html).not.toContain("Sign in to Codex");
  expect(html).not.toContain("Connect provider");
});

test("sidebar account trigger shows Settings after an unauthenticated snapshot resolves", () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarAccountTriggerContent, { account: unauthenticatedAccount() }),
  );

  expect(html).toContain("Settings");
  expect(html).not.toContain("Sign in to Codex");
  expect(html).not.toContain("Connect provider");
});

test("sidebar account trigger shows Settings without the signed-in email or avatar", () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarAccountTriggerContent, {
      account: {
        ...unauthenticatedAccount(),
        codexSignedIn: true,
        roderSignedIn: true,
        displayName: "droidpantelas@gmail.com",
        accountId: "acct_123",
      },
    }),
  );

  expect(html).toContain("Settings");
  expect(html).not.toContain("droidpantelas@gmail.com");
  expect(html).not.toContain("size-6");
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
