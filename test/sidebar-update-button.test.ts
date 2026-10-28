import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { SidebarUpdatePill } from "../src/components/sidebar-update-button";
import type { AppUpdateStatus } from "../src/lib/app-update";

const available: AppUpdateStatus = {
  state: "available",
  currentVersion: "0.1.9",
  availableVersion: "0.1.10",
};

function render(status: AppUpdateStatus, extra: Partial<ComponentProps<typeof SidebarUpdatePill>> = {}): string {
  return renderToStaticMarkup(createElement(SidebarUpdatePill, { status, onClick: () => {}, ...extra }));
}

test.each(["idle", "checking", "upToDate"] as const)("update pill stays hidden when %s", (state) => {
  expect(render({ state, currentVersion: "0.1.10" })).toBe("");
});

test("available update renders a compact, accessible pill", () => {
  const html = render(available);
  expect(html).toContain('aria-label="Update to 0.1.10"');
  expect(html).toContain('title="Update to 0.1.10"');
  expect(html).toContain("rounded-full");
  expect(html).toContain("h-7");
  expect(html).toContain(">Update</span>");
  expect(html).not.toContain("w-full");
  expect(html).not.toContain('disabled=""');
});

test("download and pending install disable repeat clicks", () => {
  for (const html of [render({ ...available, state: "downloading" }), render(available, { busy: true })]) {
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(">Updating</span>");
    expect(html).toContain("motion-reduce:animate-none");
  }
});

test("downloaded updates clearly offer restart instead of starting another download", () => {
  const html = render({ ...available, state: "ready" });
  expect(html).toContain(">Restart</span>");
  expect(html).toContain('aria-label="Restart to update"');
  expect(html).not.toContain('disabled=""');
});

test("failed updates stay actionable and explain the retry", () => {
  const html = render(available, { error: "Unable to update. Click to try again." });
  expect(html).toContain(">Retry update</span>");
  expect(html).toContain('role="alert"');
  expect(html).toContain('title="Unable to update. Click to try again."');
});

test("pill calls its update action", () => {
  const onClick = vi.fn<() => void>();
  const pill = SidebarUpdatePill({ status: available, onClick });
  const props = pill?.props as ComponentProps<"button">;
  expect(props.onClick).toBe(onClick);
});
