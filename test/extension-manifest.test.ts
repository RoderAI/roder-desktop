import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ManifestValidationError, validateExtensionManifest } from "../electron/extensions/manifest";

function helloManifest() {
  return JSON.parse(readFileSync(new URL("../examples/extensions/hello-roder/package.json", import.meta.url), "utf8"));
}

test("accepts the hello-roder example manifest", async () => {
  const manifest = validateExtensionManifest(helloManifest(), { appVersion: "0.1.0" });

  expect(manifest.id).toBe("roder.hello-roder-extension");
  expect(manifest.contributes.commands.length).toBe(2);
  expect(manifest.contributes.tools[0].id).toBe("hello-roder.echo");
  expect(manifest.capabilities).toEqual(["desktop.notification"]);
});

test("rejects path traversal in extension entry point", async () => {
  const manifest = helloManifest();
  manifest.roder.main = "../escape.js";

  expectManifestIssues(
    () => validateExtensionManifest(manifest, { appVersion: "0.1.0" }),
    ["roder.main"],
    (issue) => issue.path === "roder.main" && issue.message.includes("relative path inside"),
  );
});

test("rejects unsupported engines, capabilities, and undeclared activation targets", async () => {
  const manifest = helloManifest();
  manifest.roder.engines.roder = ">=99.0.0";
  manifest.roder.capabilities = ["network.web", "root.access"];
  manifest.roder.activationEvents.push("onTool:missing.tool");

  expectManifestIssues(
    () => validateExtensionManifest(manifest, { appVersion: "0.1.0" }),
    ["roder.engines.roder", "roder.capabilities[1]", "roder.activationEvents"],
  );
});

test("rejects malformed contribution points", async () => {
  const manifest = helloManifest();
  manifest.roder.contributes.commands[0].id = "../bad";
  manifest.roder.contributes.configuration[0].type = "token";
  manifest.roder.contributes.tools[0].inputSchema = "not schema";

  expectManifestIssues(
    () => validateExtensionManifest(manifest, { appVersion: "0.1.0" }),
    [
      "roder.contributes.commands[0].id",
      "roder.contributes.configuration[0].type",
      "roder.contributes.tools[0].inputSchema",
    ],
  );
});

function expectManifestIssues(
  action: () => unknown,
  paths: string[],
  extraCheck?: (issue: ManifestValidationError["issues"][number]) => boolean,
): void {
  let thrownError: unknown;
  try {
    action();
  } catch (error) {
    thrownError = error;
  }

  expect(thrownError).toBeInstanceOf(ManifestValidationError);
  if (!(thrownError instanceof ManifestValidationError)) {
    throw new Error("Expected manifest validation to fail");
  }

  const missingPaths = paths.filter((path) => !thrownError.issues.some((issue) => issue.path === path));
  expect(missingPaths).toEqual([]);
  expect(extraCheck ? thrownError.issues.some(extraCheck) : true).toBe(true);
}
