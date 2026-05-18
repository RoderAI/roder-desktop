import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { RoderExtensionCapability } from "@roderai/extension-api";
import type { RoderExtensionManifest } from "./manifest";
import { extractExtensionPackageArchive, readExtensionPackageFromFolder } from "./package-manager";

export type ExtensionSource =
  | {
      type: "dev";
      path: string;
    }
  | {
      type: "archive";
      path: string;
      archivePath: string;
    };

export type ExtensionCapabilityGrant = {
  capability: RoderExtensionCapability;
  status: "granted" | "denied" | "pending";
};

export type ExtensionActivationState = "inactive" | "active" | "failed";

export type ExtensionCatalogRecord = {
  id: string;
  manifest: RoderExtensionManifest;
  source: ExtensionSource;
  enabled: boolean;
  capabilities: ExtensionCapabilityGrant[];
  preferences: Record<string, string | boolean | null>;
  activationState: ExtensionActivationState;
  installedAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  lastError?: string;
  logs: string[];
};

export type ExtensionCatalogSnapshot = {
  extensions: ExtensionCatalogRecord[];
};

export type ExtensionCatalogOptions = {
  userDataPath: string;
  appVersion: string;
  now?: () => Date;
};

type PersistedCatalog = {
  version: 1;
  extensions: ExtensionCatalogRecord[];
};

export class ExtensionCatalog {
  readonly #basePath: string;
  readonly #appVersion: string;
  readonly #now: () => Date;

  constructor(options: ExtensionCatalogOptions) {
    this.#basePath = join(options.userDataPath, "extensions");
    this.#appVersion = options.appVersion;
    this.#now = options.now ?? (() => new Date());
  }

  async list(): Promise<ExtensionCatalogSnapshot> {
    const catalog = await this.#read();
    return {
      extensions: [...catalog.extensions].sort((left, right) => left.manifest.displayName.localeCompare(right.manifest.displayName)),
    };
  }

  async get(id: string): Promise<ExtensionCatalogRecord | undefined> {
    const catalog = await this.#read();
    return catalog.extensions.find((extension) => extension.id === id);
  }

  async installFromFolder(folderPath: string): Promise<ExtensionCatalogRecord> {
    const extensionPackage = await readExtensionPackageFromFolder(folderPath, this.#appVersion);
    return this.#installPackage(extensionPackage.manifest, extensionPackage.packageRoot, {
      type: "dev",
      path: extensionPackage.packageRoot,
    });
  }

  async installFromArchive(archivePath: string): Promise<ExtensionCatalogRecord> {
    const resolvedArchivePath = resolve(archivePath);
    const extensionPackage = await extractExtensionPackageArchive(resolvedArchivePath, {
      appVersion: this.#appVersion,
      installBasePath: join(this.#basePath, "installed"),
    });
    return this.#installPackage(extensionPackage.manifest, extensionPackage.packageRoot, {
      type: "archive",
      path: extensionPackage.packageRoot,
      archivePath: resolvedArchivePath,
    });
  }

  async #installPackage(manifest: RoderExtensionManifest, packageRoot: string, source: ExtensionSource): Promise<ExtensionCatalogRecord> {
    const catalog = await this.#read();
    const existing = catalog.extensions.find((extension) => extension.id === manifest.id);
    const timestamp = this.#timestamp();
    const record: ExtensionCatalogRecord = {
      id: manifest.id,
      manifest,
      source,
      enabled: existing?.enabled ?? true,
      capabilities: mergeCapabilities(manifest.capabilities, existing?.capabilities),
      preferences: mergePreferences(manifest, existing?.preferences),
      activationState: "inactive",
      installedAt: existing?.installedAt ?? timestamp,
      updatedAt: timestamp,
      lastActivatedAt: existing?.lastActivatedAt,
      lastError: undefined,
      logs: appendLog(existing?.logs ?? [], timestamp, `Installed ${manifest.displayName} from ${packageRoot}`),
    };

    catalog.extensions = [...catalog.extensions.filter((extension) => extension.id !== record.id), record];
    await this.#write(catalog);
    return record;
  }

  async uninstall(id: string): Promise<ExtensionCatalogSnapshot> {
    const catalog = await this.#read();
    catalog.extensions = catalog.extensions.filter((extension) => extension.id !== id);
    await this.#write(catalog);
    return this.list();
  }

  async enable(id: string): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      enabled: true,
      activationState: "inactive",
      lastError: undefined,
      updatedAt: this.#timestamp(),
      logs: appendLog(record.logs, this.#timestamp(), "Enabled extension"),
    }));
  }

  async disable(id: string): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      enabled: false,
      activationState: "inactive",
      updatedAt: this.#timestamp(),
      logs: appendLog(record.logs, this.#timestamp(), "Disabled extension"),
    }));
  }

  async reload(id: string): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      activationState: "inactive",
      lastError: undefined,
      updatedAt: this.#timestamp(),
      logs: appendLog(record.logs, this.#timestamp(), "Reload requested"),
    }));
  }

  async updatePreference(id: string, key: string, value: string | boolean | null): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      preferences: {
        ...record.preferences,
        [key]: value,
      },
      updatedAt: this.#timestamp(),
      logs: appendLog(record.logs, this.#timestamp(), `Updated preference ${key}`),
    }));
  }

  async readLogs(id: string): Promise<string[]> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Extension ${id} is not installed`);
    }
    return record.logs;
  }

  async appendLog(id: string, message: string): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      logs: appendLog(record.logs, this.#timestamp(), message),
    }));
  }

  async markFailed(id: string, error: Error): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      activationState: "failed",
      lastError: error.message,
      updatedAt: this.#timestamp(),
      logs: appendLog(record.logs, this.#timestamp(), `Error: ${error.message}`),
    }));
  }

  async markActive(id: string): Promise<ExtensionCatalogRecord> {
    return this.#updateRecord(id, (record) => ({
      ...record,
      activationState: "active",
      lastActivatedAt: this.#timestamp(),
      lastError: undefined,
      logs: appendLog(record.logs, this.#timestamp(), "Activated extension"),
    }));
  }

  async #updateRecord(id: string, update: (record: ExtensionCatalogRecord) => ExtensionCatalogRecord): Promise<ExtensionCatalogRecord> {
    const catalog = await this.#read();
    const index = catalog.extensions.findIndex((extension) => extension.id === id);
    if (index === -1) {
      throw new Error(`Extension ${id} is not installed`);
    }
    const record = update(catalog.extensions[index]);
    catalog.extensions[index] = record;
    await this.#write(catalog);
    return record;
  }

  async #read(): Promise<PersistedCatalog> {
    await mkdir(this.#basePath, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.#catalogPath(), "utf8")) as Partial<PersistedCatalog>;
      return {
        version: 1,
        extensions: Array.isArray(parsed.extensions) ? parsed.extensions.map(normalizeRecord).filter(isExtensionCatalogRecord) : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, extensions: [] };
      }
      throw error;
    }
  }

  async #write(catalog: PersistedCatalog): Promise<void> {
    await mkdir(this.#basePath, { recursive: true });
    const catalogPath = this.#catalogPath();
    const tmpPath = `${catalogPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await rename(tmpPath, catalogPath);
  }

  #catalogPath(): string {
    return join(this.#basePath, "catalog.json");
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

function mergeCapabilities(
  capabilities: RoderExtensionCapability[],
  existing: ExtensionCapabilityGrant[] | undefined,
): ExtensionCapabilityGrant[] {
  const existingByCapability = new Map(existing?.map((grant) => [grant.capability, grant.status]) ?? []);
  return capabilities.map((capability) => ({
    capability,
    status: existingByCapability.get(capability) ?? "pending",
  }));
}

function mergePreferences(
  manifest: RoderExtensionManifest,
  existing: Record<string, string | boolean | null> | undefined,
): Record<string, string | boolean | null> {
  const preferences: Record<string, string | boolean | null> = {};
  for (const contribution of manifest.contributes.configuration) {
    preferences[contribution.key] = existing?.[contribution.key] ?? contribution.default ?? null;
  }
  return preferences;
}

function appendLog(logs: string[], timestamp: string, message: string): string[] {
  return [...logs, `[${timestamp}] ${message}`].slice(-200);
}

function normalizeRecord(value: unknown): ExtensionCatalogRecord | undefined {
  const record = value as Partial<ExtensionCatalogRecord> | undefined;
  if (!record || typeof record.id !== "string" || !record.manifest || !record.source || !["dev", "archive"].includes(record.source.type)) {
    return undefined;
  }
  return {
    ...(record as ExtensionCatalogRecord),
    source: {
      ...record.source,
      path: resolve(record.source.path),
    },
    capabilities: Array.isArray(record.capabilities) ? record.capabilities : [],
    preferences: record.preferences ?? {},
    activationState: record.activationState ?? "inactive",
    logs: Array.isArray(record.logs) ? record.logs : [],
  };
}

function isExtensionCatalogRecord(value: ExtensionCatalogRecord | undefined): value is ExtensionCatalogRecord {
  return value !== undefined;
}
