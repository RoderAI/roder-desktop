import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { CloudMachinesService } from "../electron/cloud-machines/service";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "roder-cloud-machines-"));
  directories.push(directory);
  const key = randomBytes(32);
  const options = {
    filePath: join(directory, "nested", "machines.enc"),
    encryptionAvailable: () => true,
    encrypt: (text: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt: (buffer: Buffer) => {
      const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      cipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
  return { options, service: new CloudMachinesService(options) };
}

const input = {
  id: "development",
  name: "Development",
  providerId: "ssh",
  workspace: "/workspace/app",
  readRoots: ["/data"],
  config: { host: "private.example", port: 2222 },
};

test("persists encrypted profiles, lists only metadata and resolves runners after restart", async () => {
  const { service, options } = await setup();
  expect(await service.list()).toEqual({ machines: [] });
  const { config: _, ...metadata } = input;
  expect(await service.save(input)).toEqual({ machine: metadata });
  expect(await service.list()).toEqual({ machines: [metadata] });
  const bytes = await readFile(options.filePath);
  expect(bytes.toString("utf8")).not.toContain("private.example");
  expect(bytes.toString("utf8")).not.toContain("Development");
  expect((await stat(options.filePath)).mode & 0o777).toBe(0o600);
  const restarted = new CloudMachinesService(options);
  expect(await restarted.runnerFor(input.id)).toEqual({
    providerId: input.providerId,
    workspace: input.workspace,
    readRoots: input.readRoots,
    config: input.config,
  });
  await restarted.save({ ...input, name: "Updated" });
  expect((await restarted.list()).machines).toHaveLength(1);
  expect((await restarted.list()).machines[0].name).toBe("Updated");
  expect(await restarted.remove(input.id)).toEqual({ removed: true });
  expect(await new CloudMachinesService(options).list()).toEqual({ machines: [] });
});

test("generates IDs and serializes concurrent mutations without losing profiles", async () => {
  const { service } = await setup();
  const { id: _, ...newInput } = input;
  const results = await Promise.all(Array.from({ length: 12 }, () => service.save(newInput)));
  expect(new Set(results.map(({ machine }) => machine.id)).size).toBe(12);
  expect((await service.list()).machines).toHaveLength(12);
});

test.each([
  null,
  { ...input, id: "" },
  { ...input, name: " " },
  { ...input, providerId: "" },
  { ...input, workspace: "relative" },
  { ...input, workspace: "C:\\workspace" },
  { ...input, workspace: "/bad\0path" },
  { ...input, readRoots: ["relative"] },
  { ...input, readRoots: "/data" },
  { ...input, config: [] },
  { ...input, config: { missing: undefined } },
  { ...input, config: { invalid: Number.NaN } },
  { ...input, config: { date: new Date() } },
  { ...input, config: { callback: () => null } },
  { ...input, config: { token: "secret" } },
  { ...input, config: { nested: { password: "secret" } } },
  { ...input, config: { url: "https://user:password@example.com" } },
])("rejects invalid profile %# without writing", async (invalid) => {
  const { service } = await setup();
  await expect(service.save(invalid)).rejects.toThrow(/./);
  expect(await service.list()).toEqual({ machines: [] });
  await service.save(input);
});

test("rejects cyclic config and does not expose mutable stored config", async () => {
  const { service } = await setup();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await expect(service.save({ ...input, config: cyclic })).rejects.toThrow(/JSON/);
  await service.save(input);
  const runner = await service.runnerFor(input.id);
  runner.config.host = "modified";
  expect((await service.runnerFor(input.id)).config.host).toBe("private.example");
});

test("fails closed without encryption but allows an empty initial listing", async () => {
  const { options, service } = await setup();
  const unavailable = new CloudMachinesService({ ...options, encryptionAvailable: () => false });
  expect(await unavailable.list()).toEqual({ machines: [] });
  await expect(unavailable.save(input)).rejects.toThrow(/encryption/i);
  await service.save(input);
  const previous = await readFile(options.filePath);
  await expect(unavailable.list()).rejects.toThrow(/encryption/i);
  await expect(unavailable.runnerFor(input.id)).rejects.toThrow(/encryption/i);
  await expect(unavailable.remove(input.id)).rejects.toThrow(/encryption/i);
  expect(await readFile(options.filePath)).toEqual(previous);
});

test("reports missing machines and invalid IDs", async () => {
  const { service } = await setup();
  await expect(service.runnerFor("missing")).rejects.toThrow(/not found/i);
  await expect(service.remove("missing")).rejects.toThrow(/not found/i);
  await expect(service.runnerFor("")).rejects.toThrow(/id/i);
  await expect(service.remove("")).rejects.toThrow(/id/i);
});

test("leaves existing storage intact when encryption fails", async () => {
  const { service, options } = await setup();
  await service.save(input);
  const previous = await readFile(options.filePath);
  const broken = new CloudMachinesService({
    ...options,
    encrypt: () => {
      throw new Error("Encryption failed");
    },
  });
  await expect(broken.save({ ...input, name: "Replacement" })).rejects.toThrow("Encryption failed");
  expect(await readFile(options.filePath)).toEqual(previous);
  expect((await broken.list()).machines[0].name).toBe(input.name);
});

test("never overwrites corrupt storage or plaintext with an empty database", async () => {
  const { options, service } = await setup();
  await service.save(input);
  await writeFile(options.filePath, "invalid ciphertext");
  await expect(service.save({ ...input, name: "Replacement" })).rejects.toThrow(/encrypted cloud machine storage/);
  expect(await readFile(options.filePath, "utf8")).toBe("invalid ciphertext");
  await writeFile(
    options.filePath,
    options.encrypt(JSON.stringify({ machines: [{ ...input, workspace: "relative" }] })),
  );
  await expect(service.list()).rejects.toThrow(/encrypted cloud machine storage/);
});
