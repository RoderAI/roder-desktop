import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  CloudMachine,
  CloudMachineInput,
  CloudRunnerProvider,
  LocalSshEnvironment,
  LocalTailscaleStatus,
  TailscaleCredentialStatus,
} from "../src/lib/cloud-machines";
import { effectiveRunnerProviderId, remoteRunnerTargetName } from "../src/lib/cloud-machines";
import { machineProviderHelp } from "../src/lib/cloud-machine-providers";

const snapshot = vi.hoisted(() => ({
  machines: [] as CloudMachine[],
  providers: [] as CloudRunnerProvider[],
  localTailscale: null as LocalTailscaleStatus | null,
  tailscaleCredentials: null as TailscaleCredentialStatus | null,
  localSsh: null as LocalSshEnvironment | null,
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
  snapshot.localTailscale = null;
  snapshot.tailscaleCredentials = null;
  snapshot.localSsh = null;
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

test("machine settings opens on saved profiles and keeps the editor closed until requested", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Machines<\/button>/);
  expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Connections<\/button>/);
  expect(html).toMatch(/<form[^>]*hidden=""/);
  expect(html).toContain("Manage connections");
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

test("provider submenu lists discovered runners and explains authentication limitations", () => {
  snapshot.providers = [
    { provider_id: "sprites", capabilities: {} },
    { provider_id: "daytona", capabilities: {} },
  ];
  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toContain("Manage runner providers");
  expect(html).toContain("sprites");
  expect(html).toContain("daytona");
  expect(html).toContain("Sign-in and credential management are not available here");
  expect(html).toContain("Configure machine");
  expect(html).not.toContain('type="password"');
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
  expect(machineProviderHelp("tailscale").description).toContain("Tailscale");
  expect(machineProviderHelp("future-provider").config).toEqual({});
});

test("renders Tailscale tunnel status, discovered peers, and preserves effectiveRunnerProviderId", () => {
  snapshot.providers = [{ provider_id: "tailscale", capabilities: {} }];
  snapshot.localTailscale = {
    installed: true,
    running: true,
    backendState: "Running",
    version: "1.104.2",
    binaryPath: "/usr/bin/tailscale",
    tailnetName: "user@example.com",
    magicDnsSuffix: "drum-sunfish.ts.net",
    self: {
      hostName: "iusearchbtw",
      dnsName: "iusearchbtw.drum-sunfish.ts.net",
      tailscaleIp: "100.76.53.91",
      os: "linux",
      sshCapable: true,
      httpsEnabled: true,
    },
    peers: [
      {
        id: "peer-1",
        hostName: "devbox",
        dnsName: "devbox.drum-sunfish.ts.net",
        tailscaleIp: "100.90.10.20",
        os: "linux",
        online: true,
        active: true,
        lastSeen: null,
        tags: [],
      },
    ],
  };
  snapshot.tailscaleCredentials = {
    configured: true,
    mode: "oauth",
    source: "saved",
    preview: "tske…abcd",
    oauthClientId: "kClient1",
    tags: ["tag:roder"],
    tailnet: null,
    preferForSandboxes: true,
  };
  snapshot.machines = [{ id: "ts-1", name: "devbox", providerId: "tailscale", workspace: "/home/pz/app" }];

  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toContain("Tailscale tunnel");
  expect(html).toContain("drum-sunfish.ts.net");
  expect(html).toContain("iusearchbtw.drum-sunfish.ts.net");
  expect(html).toContain("1/1 tailnet peers online");
  expect(html).toContain("OAuth auto-minting (tag:roder)");
  expect(html).toContain("devbox (linux) · 100.90.10.20");
  expect(html).not.toContain('type="password"');

  expect(
    effectiveRunnerProviderId({
      providerId: "runloop",
      config: { roder_transport: "tailscale", machine_name: "devbox" },
    }),
  ).toBe("tailscale");
  expect(
    remoteRunnerTargetName({
      providerId: "runloop",
      workspace: "/home/pz/app",
      config: { roder_transport: "tailscale", machine_name: "devbox" },
    }),
  ).toBe("devbox");
});

test("renders first-party SSH servers card with discovered ~/.ssh/config hosts and guided SSH setup", () => {
  snapshot.providers = [{ provider_id: "ssh", capabilities: {} }];
  snapshot.localSsh = {
    installed: true,
    binaryPath: "/usr/bin/ssh",
    configPath: "/home/pz/.ssh/config",
    hosts: [
      {
        alias: "hetzner-prod",
        hostName: "203.0.113.10",
        user: "root",
        port: 2222,
        identityFile: "~/.ssh/Hetzner",
        proxyJump: null,
      },
    ],
    identityFiles: ["~/.ssh/Hetzner", "~/.ssh/id_ed25519"],
  };
  snapshot.machines = [{ id: "ssh-1", name: "hetzner-prod", providerId: "ssh", workspace: "/srv/app" }];

  const html = renderToStaticMarkup(React.createElement(SettingsCloudMachinesPanel));
  expect(html).toContain("SSH servers");
  expect(html).toContain("OpenSSH ready");
  expect(html).toContain("hetzner-prod");
  expect(html).toContain("~/.ssh/Hetzner");
  expect(html).toContain("Quick paste (optional)");
  expect(html).toContain("ProxyJump / bastion");
  expect(html).not.toContain('type="password"');
});
