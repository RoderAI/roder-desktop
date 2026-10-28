import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CloudMachine, CloudMachineInput, CloudRunnerProvider } from "../src/lib/cloud-machines";
import { machineProviderHelp } from "../src/lib/cloud-machine-providers";

const snapshot = vi.hoisted(() => ({
  machines: [] as CloudMachine[],
  providers: [] as CloudRunnerProvider[],
  selectedMachineId: "",
  error: "",
  busy: false,
  refresh: vi.fn<() => Promise<void>>(),
  save: vi.fn<(input: CloudMachineInput) => Promise<void>>(),
  remove: vi.fn<(id: string) => Promise<void>>(),
  select: vi.fn<(id: string) => void>(),
}));

vi.mock("../src/stores/cloud-machines-store", () => ({
  useCloudMachinesStore: (selector: (state: typeof snapshot) => unknown) => selector(snapshot),
}));

import { CloudMachinePicker } from "../src/components/cloud-machine-picker";
import { SettingsCloudMachinesPanel } from "../src/components/settings-cloud-machines-panel";

beforeEach(() => {
  snapshot.machines = [];
  snapshot.providers = [];
  snapshot.selectedMachineId = "";
  snapshot.error = "";
  snapshot.busy = false;
});

afterEach(() => vi.unstubAllGlobals());

test("Windows disables cloud profile setup and selection while preserving local selection", () => {
  vi.stubGlobal("window", { roderDesktop: { platform: "win32" } });
  snapshot.providers = [{ provider_id: "sprites", capabilities: {} }];
  snapshot.machines = [{ id: "dev", name: "Development", providerId: "sprites", workspace: "/work" }];
  const settings = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(settings).toContain("Cloud machines are not supported on Windows yet");
  expect(settings).toMatch(/<fieldset[^>]*disabled=""/);
  const picker = renderToStaticMarkup(React.createElement(CloudMachinePicker));
  expect(picker).toMatch(/<option value="dev" disabled="">Development \(unavailable on Windows\)/);
  expect(picker).toMatch(/<option value="" selected="">Local machine/);
  expect(picker).not.toMatch(/<select[^>]*disabled=""/);
});

test("Windows preserves an unavailable saved cloud selection rather than silently selecting local", () => {
  vi.stubGlobal("window", { roderDesktop: { platform: "win32" } });
  snapshot.providers = [{ provider_id: "sprites", capabilities: {} }];
  snapshot.machines = [{ id: "dev", name: "Development", providerId: "sprites", workspace: "/work" }];
  snapshot.selectedMachineId = "dev";
  const picker = renderToStaticMarkup(React.createElement(CloudMachinePicker));
  expect(picker).toMatch(/<option value="dev" disabled="" selected="">Development \(unavailable on Windows\)/);
  expect(picker).not.toMatch(/<option value="" selected="">Local machine/);
});

test("empty settings explain local execution and disable unavailable provider setup", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toContain("No cloud machines configured.");
  expect(html).toContain("No remote runner providers available.");
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toContain("Never enter passwords, API keys, or tokens here.");
});

test("supported providers render their setup hint and relevant non-secret example", () => {
  snapshot.providers = [{ provider_id: "sprites", capabilities: {}, setup_hint: "Create a Sprite before connecting." }];
  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toContain("Create a Sprite before connecting.");
  expect(html).toContain("SPRITES_TOKEN");
  expect(html).toContain("sprite_name");
  expect(html).toContain("Use example");
  expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).not.toContain("DAYTONA_API_KEY");
});

test("picker renders local and saved machines and preserves a supported selection", () => {
  snapshot.providers = [{ provider_id: "sprites", capabilities: {} }];
  snapshot.machines = [{ id: "dev", name: "Development", providerId: "sprites", workspace: "/work" }];
  snapshot.selectedMachineId = "dev";
  const html = renderToStaticMarkup(React.createElement(CloudMachinePicker, { disabled: true }));
  expect(html).toContain("Local machine");
  expect(html).toMatch(/<option value="dev" selected="">Development<\/option>/);
  expect(html).toMatch(/<select[^>]*disabled=""/);
});

test("missing selected profiles remain visible rather than rendering local as selected", () => {
  snapshot.selectedMachineId = "removed";
  const html = renderToStaticMarkup(React.createElement(CloudMachinePicker));
  expect(html).toMatch(/<option value="removed" disabled="" selected="">Unavailable machine/);
  expect(html).not.toMatch(/<option value="" selected="">Local machine/);
});

test("unsupported saved providers remain visible and disabled in the picker", () => {
  snapshot.machines = [{ id: "old", name: "Old sandbox", providerId: "removed-provider", workspace: "/remote" }];
  snapshot.selectedMachineId = "old";
  const picker = renderToStaticMarkup(React.createElement(CloudMachinePicker));
  expect(picker).toMatch(/<option value="old" disabled="" selected="">Old sandbox \(provider unavailable\)/);
  const settings = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(settings).toContain("Provider unavailable in the current runtime.");
  expect(settings).toContain("Old sandbox");
});

test("settings render backend errors and a loading discovery state", () => {
  snapshot.error = "App-server unavailable";
  snapshot.busy = true;
  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toContain('role="alert"');
  expect(html).toContain("App-server unavailable");
  expect(html).toContain("Loading remote runner providers...");
});

test.each(["cloudflare", "daytona", "e2b", "modal", "runloop", "vercel"])(
  "%s help distinguishes compatible gateways from native vendor APIs",
  (providerId) => {
    const help = machineProviderHelp(providerId);
    expect(help.description).toContain("/sessions");
    expect(help.description).toContain("not the vendor's native API");
    expect(help.environment).toHaveLength(1);
    expect(help.config).toEqual({ base_url: "https://your-runner-gateway" });
  },
);

test("local provider help does not request cloud credentials", () => {
  expect(machineProviderHelp("docker").environment).toEqual([]);
  expect(machineProviderHelp("unix-local").description).toContain("not a cloud sandbox");
  expect(machineProviderHelp("future-provider").config).toEqual({});
});
