import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { zipSync } from "fflate";
import { ExtensionCatalog } from "../electron/extensions/catalog";

function createExtensionFixture() {
  const directory = mkdtempSync(join(tmpdir(), "hello-roder-extension-"));
  writeFileSync(join(directory, "extension.js"), "export function activate() {}\n");
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "hello-roder-extension",
        version: "0.1.0",
        description: "Catalog test extension.",
        roder: {
          displayName: "Hello Roder",
          publisher: "roder",
          engines: { roder: ">=0.0.0" },
          main: "extension.js",
          activationEvents: ["onCommand:hello-roder.sayHello"],
          capabilities: ["desktop.notification"],
          contributes: {
            commands: [{ id: "hello-roder.sayHello", title: "Say Hello" }],
            tools: [],
            configuration: [{ key: "hello-roder.greeting", title: "Greeting", type: "text", default: "Hi" }],
            views: { panels: [] },
          },
        },
      },
      null,
      2,
    ),
  );
  return directory;
}

test("catalog installs a local extension folder and persists its record", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "roder-user-data-"));
  const fixturePath = createExtensionFixture();
  const now = () => new Date("2026-05-18T21:45:00.000Z");
  const catalog = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0", now });

  const installed = await catalog.installFromFolder(fixturePath);
  expect(installed.id).toBe("roder.hello-roder-extension");
  expect(installed.enabled).toBe(true);
  expect(installed.source.type).toBe("dev");
  expect(installed.source.path).toBe(fixturePath);
  expect(installed.capabilities).toEqual([{ capability: "desktop.notification", status: "pending" }]);
  expect(installed.preferences["hello-roder.greeting"]).toBe("Hi");

  const reloaded = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0", now });
  const snapshot = await reloaded.list();
  expect(snapshot.extensions.length).toBe(1);
  expect(snapshot.extensions[0].manifest.displayName).toBe("Hello Roder");
});

test("catalog installs an .rdx archive into app storage", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "roder-user-data-"));
  const fixturePath = createExtensionFixture();
  const archivePath = join(mkdtempSync(join(tmpdir(), "roder-rdx-")), "hello.rdx");
  writeFileSync(
    archivePath,
    zipSync({
      "package.json": readFileSync(join(fixturePath, "package.json")),
      "extension.js": readFileSync(join(fixturePath, "extension.js")),
    }),
  );
  const catalog = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0" });

  const installed = await catalog.installFromArchive(archivePath);
  expect(installed.id).toBe("roder.hello-roder-extension");
  expect(installed.source.type).toBe("archive");
  expect(installed.source.archivePath).toBe(archivePath);
  expect(installed.source.path).toMatch(/extensions\/installed\/roder\.hello-roder-extension$/);

  const snapshot = await catalog.list();
  expect(snapshot.extensions[0].source.type).toBe("archive");
  expect(snapshot.extensions[0].manifest.displayName).toBe("Hello Roder");
});

test("catalog can disable, re-enable, reload, update preferences, and uninstall", async () => {
  const catalog = new ExtensionCatalog({
    userDataPath: mkdtempSync(join(tmpdir(), "roder-user-data-")),
    appVersion: "0.1.0",
    now: () => new Date("2026-05-18T21:46:00.000Z"),
  });
  const installed = await catalog.installFromFolder(createExtensionFixture());

  const disabled = await catalog.disable(installed.id);
  expect(disabled.enabled).toBe(false);
  const enabled = await catalog.enable(installed.id);
  expect(enabled.enabled).toBe(true);
  const updated = await catalog.updatePreference(installed.id, "hello-roder.greeting", "Aloha");
  expect(updated.preferences["hello-roder.greeting"]).toBe("Aloha");
  const reloaded = await catalog.reload(installed.id);
  expect(reloaded.activationState).toBe("inactive");
  expect((await catalog.readLogs(installed.id)).join("\n")).toMatch(/Reload requested/);

  const snapshot = await catalog.uninstall(installed.id);
  expect(snapshot.extensions.length).toBe(0);
});

test("catalog rejects folders with invalid manifests", async () => {
  const catalog = new ExtensionCatalog({
    userDataPath: mkdtempSync(join(tmpdir(), "roder-user-data-")),
    appVersion: "0.1.0",
  });
  const fixturePath = createExtensionFixture();
  const manifest = JSON.parse(readFileSync(join(fixturePath, "package.json"), "utf8"));
  manifest.roder.main = "../escape.js";
  writeFileSync(join(fixturePath, "package.json"), JSON.stringify(manifest, null, 2));

  await expect(() => catalog.installFromFolder(fixturePath)).rejects.toThrow(
    /relative path inside the extension package/,
  );
});

test("catalog rejects .rdx archives with unsafe paths", async () => {
  const catalog = new ExtensionCatalog({
    userDataPath: mkdtempSync(join(tmpdir(), "roder-user-data-")),
    appVersion: "0.1.0",
  });
  const fixturePath = createExtensionFixture();
  const archivePath = join(mkdtempSync(join(tmpdir(), "roder-rdx-")), "unsafe.rdx");
  writeFileSync(
    archivePath,
    zipSync({
      "package.json": readFileSync(join(fixturePath, "package.json")),
      "../escape.js": Buffer.from("export function activate() {}\n"),
    }),
  );

  await expect(() => catalog.installFromArchive(archivePath)).rejects.toThrow(/Unsafe extension archive entry/);
});
