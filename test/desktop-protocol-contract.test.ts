import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const apiDocs = readFileSync(new URL("../docs/api.md", import.meta.url), "utf8");

const documentedDesktopMethods = [
  "initialize",
  "thread/list",
  "thread/read",
  "thread/start",
  "thread/goal/get",
  "thread/state",
  "thread/set_mode",
  "thread/exit_plan",
  "thread/resolve_approval",
  "thread/resolve_user_input",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "model/list",
  "skills/list",
  "skills/setEnabled",
  "skills/setExposure",
  "vcs/changes/list",
  "vcs/changes/read",
  "workspace/list",
  "workspace/create",
  "workspace/update",
  "workspace/forget",
  "speech/providers/list",
  "speech/transcribe",
];

test("api docs describe the desktop methods the Electron bridge uses", () => {
  for (const method of documentedDesktopMethods) {
    expect(apiDocs).toMatch(new RegExp(`\\b${method.replace("/", "\\/")}\\b`));
  }
});
