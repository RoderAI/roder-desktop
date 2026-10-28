import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validateMachineConfig } from "../../src/lib/cloud-machines";

export interface CloudMachine {
  id: string;
  name: string;
  providerId: string;
  workspace: string;
  readRoots?: string[];
}

export interface CloudMachineRunner {
  providerId: string;
  workspace: string;
  config: Record<string, unknown>;
  readRoots?: string[];
}

interface StoredMachine extends CloudMachine {
  config: Record<string, unknown>;
}

export interface CloudMachinesServiceOptions {
  filePath: string;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
  encryptionAvailable: () => boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function remotePath(value: unknown, field: string): string {
  const path = text(value, field);
  if (!path.startsWith("/") || path.includes("\\")) {
    throw new Error(`${field} must be an absolute POSIX path`);
  }
  return path;
}

function assertJson(value: unknown, ancestors = new Set<unknown>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if ((!Array.isArray(value) && !record(value)) || ancestors.has(value)) {
    throw new Error("config must contain only plain JSON values");
  }
  ancestors.add(value);
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new Error("config must contain only plain JSON values");
  }
  for (const item of Object.values(value)) assertJson(item, ancestors);
  ancestors.delete(value);
}

function profile(value: unknown, generateId: boolean): StoredMachine {
  if (!record(value)) throw new Error("Cloud machine must be an object");
  const id = value.id === undefined && generateId ? randomUUID() : text(value.id, "id");
  const name = text(value.name, "name");
  const providerId = text(value.providerId, "providerId");
  const workspace = remotePath(value.workspace, "workspace");
  if (!record(value.config)) throw new Error("config must be a plain JSON object");
  assertJson(value.config);
  const config = validateMachineConfig(value.config);
  let readRoots: string[] | undefined;
  if (value.readRoots !== undefined) {
    if (!Array.isArray(value.readRoots)) throw new Error("readRoots must be an array");
    readRoots = value.readRoots.map((path) => remotePath(path, "readRoots"));
  }
  return { id, name, providerId, workspace, config, ...(readRoots === undefined ? {} : { readRoots }) };
}

function metadata({ id, name, providerId, workspace, readRoots }: StoredMachine): CloudMachine {
  return { id, name, providerId, workspace, ...(readRoots === undefined ? {} : { readRoots }) };
}

export class CloudMachinesService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: CloudMachinesServiceOptions) {}

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private requireEncryption(): void {
    if (!this.options.encryptionAvailable()) {
      throw new Error("Cloud machine storage encryption is unavailable");
    }
  }

  private async read(): Promise<StoredMachine[]> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.options.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    this.requireEncryption();
    try {
      const data: unknown = JSON.parse(this.options.decrypt(bytes));
      if (!record(data) || !Array.isArray(data.machines)) throw new Error("Invalid storage");
      const machines = data.machines.map((machine) => profile(machine, false));
      if (new Set(machines.map((machine) => machine.id)).size !== machines.length) {
        throw new Error("Duplicate machine IDs");
      }
      return machines;
    } catch {
      // Never include decrypted config or cipher errors in renderer-facing messages.
      throw new Error("Unable to read encrypted cloud machine storage");
    }
  }

  private async write(machines: StoredMachine[]): Promise<void> {
    this.requireEncryption();
    const bytes = this.options.encrypt(JSON.stringify({ machines }));
    await mkdir(dirname(this.options.filePath), { recursive: true });
    const temporaryPath = `${this.options.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.options.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  list(): Promise<{ machines: CloudMachine[] }> {
    return this.serialized(async () => ({ machines: (await this.read()).map(metadata) }));
  }

  save(input: unknown): Promise<{ machine: CloudMachine }> {
    // Snapshot before queuing so caller mutations cannot alter a pending write.
    let machine: StoredMachine;
    try {
      machine = JSON.parse(JSON.stringify(profile(input, true))) as StoredMachine;
    } catch (error) {
      return Promise.reject(error);
    }
    return this.serialized(async () => {
      this.requireEncryption();
      const machines = await this.read();
      const index = machines.findIndex((existing) => existing.id === machine.id);
      if (index === -1) machines.push(machine);
      else machines[index] = machine;
      await this.write(machines);
      return { machine: metadata(machine) };
    });
  }

  remove(id: string): Promise<{ removed: true }> {
    return this.serialized(async () => {
      text(id, "id");
      this.requireEncryption();
      const machines = await this.read();
      if (!machines.some((machine) => machine.id === id)) throw new Error("Cloud machine not found");
      await this.write(machines.filter((machine) => machine.id !== id));
      return { removed: true };
    });
  }

  runnerFor(id: string): Promise<CloudMachineRunner> {
    return this.serialized(async () => {
      text(id, "id");
      const machine = (await this.read()).find((candidate) => candidate.id === id);
      if (!machine) throw new Error("Cloud machine not found");
      const { providerId, config, workspace, readRoots } = machine;
      return { providerId, config, workspace, ...(readRoots === undefined ? {} : { readRoots }) };
    });
  }
}
