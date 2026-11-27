import { EventEmitter } from "node:events";
import type {
  VcsChangeArea,
  VcsChangeStatus,
  VcsChangedFile,
  VcsChangesListResult,
  VcsChangesReadResult,
  WorkspaceFileEntry,
  WorkspaceFilesChildrenResult,
  WorkspaceFilesQueryMatch,
  WorkspaceFilesQueryResult,
  WorkspaceFilesReadResult,
  WorkspaceFilesRebuildResult,
  WorkspaceFilesStatus,
  WorkspaceFilesStatusResult,
} from "../../src/types/roder";
import type { ThreadRunner } from "../../src/lib/cloud-machines";
import type { BlaxelClient } from "./blaxel-client";
import type { BlaxelAuth, CloudCredentialsService } from "./credentials";
import {
  RemoteRoderTunnelManager,
  RemoteRoderUnsupportedRuntimeError,
  rewriteRemoteFileEntry,
  rewriteRemoteFilesStatus,
  tunnelKey,
  type ActiveRemoteTunnel,
  type RemoteTunnelNotification,
} from "./remote-roder-tunnel";
import type { CloudMachinesService } from "./service";

export const REMOTE_WORKSPACE_ROOT_ID = "remote-root";
const INDEX_CACHE_TTL_MS = 15_000;
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

export type ResolvedRemoteTarget = {
  workspaceId: string;
  rootId: string;
  rootName: string;
  providerId: string;
  workspace: string;
  config: Record<string, unknown>;
  targetName: string;
};

export type RemoteRunnerStatusSnapshot = {
  workspaceId: string;
  providerId: string;
  targetName: string;
  workspace: string;
  blaxelWorkspace?: string | null;
  status: string;
  region?: string | null;
  url?: string | null;
  reachable: boolean;
  bridgeMode?: "remote-roder-tunnel" | "blaxel-api" | "pending";
  bridgeDetail?: string;
  message?: string;
};

type IndexedRemoteEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
};

type CachedPathIndex = {
  entries: IndexedRemoteEntry[];
  fileCount: number;
  directoryCount: number;
  expiresAt: number;
};

export type RemoteWorkspaceServiceOptions = {
  blaxelClient: BlaxelClient;
  credentialsService: CloudCredentialsService;
  machinesService: CloudMachinesService;
  readThreadRunner: (threadId: string) => Promise<ThreadRunner | null>;
  tunnelManager?: RemoteRoderTunnelManager;
  disableTunnel?: boolean;
};

export function isRemoteWorkspaceId(workspaceId: unknown): workspaceId is string {
  return typeof workspaceId === "string" && workspaceId.startsWith("remote:");
}

export function remoteWorkspaceIdForThread(threadId: string): string {
  return `remote:thread:${threadId}`;
}

export function remoteWorkspaceIdForMachine(machineId: string): string {
  return `remote:machine:${machineId}`;
}

export function shellQuotePosix(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export function normalizePosixRelativePath(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (!cleaned || cleaned === ".") return "";
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\0"))) {
    throw new Error("Remote file path must stay within the workspace root.");
  }
  return segments.join("/");
}

export function joinPosixWorkspacePath(root: string, relativePath: string): string {
  const cleanRoot = root.length > 1 ? root.replace(/\/+$/u, "") : root;
  const cleanRelative = normalizePosixRelativePath(relativePath);
  if (!cleanRelative) return cleanRoot || "/";
  return cleanRoot === "/" ? `/${cleanRelative}` : `${cleanRoot}/${cleanRelative}`;
}

export function blaxelSandboxNameFromConfig(config: Record<string, unknown> | undefined): string {
  if (!config) return "";
  const candidate = config.sandbox_name ?? config.sandboxName ?? config.name;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function blaxelWorkspaceFromConfig(config: Record<string, unknown> | undefined): string {
  if (!config) return "";
  const candidate = config.workspace;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function remoteRunnerTargetLabel(runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">): string {
  if (runner.providerId === "blaxel") {
    const sandboxName = blaxelSandboxNameFromConfig(runner.config);
    if (sandboxName) return sandboxName;
  }
  if (runner.providerId === "sprites") {
    const sprite = runner.config?.sprite_name;
    if (typeof sprite === "string" && sprite.trim()) return sprite.trim();
  }
  return runner.workspace.split("/").filter(Boolean).pop() || runner.providerId;
}

export class RemoteWorkspaceService extends EventEmitter {
  private readonly threadRunners = new Map<string, ThreadRunner>();
  private readonly pathIndexCache = new Map<string, CachedPathIndex>();
  private readonly tunnelManager: RemoteRoderTunnelManager;

  constructor(private readonly options: RemoteWorkspaceServiceOptions) {
    super();
    this.tunnelManager =
      options.tunnelManager ??
      new RemoteRoderTunnelManager({
        blaxelClient: options.blaxelClient,
      });
    this.tunnelManager.on(
      "notification",
      ({ notification }: { desktopWorkspaceId: string; notification: RemoteTunnelNotification }) => {
        this.emit("notification", notification);
      },
    );
  }

  closeAll(): void {
    this.tunnelManager.closeAll();
    this.pathIndexCache.clear();
  }

  async proxyRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
    if (!workspaceId || !isRemoteWorkspaceId(workspaceId)) {
      throw new Error("A remote workspaceId is required.");
    }

    if (!this.options.disableTunnel) {
      try {
        return await this.requestViaTunnel(method, workspaceId, params);
      } catch (error) {
        if (!(error instanceof RemoteRoderUnsupportedRuntimeError)) {
          // Only fall back to direct Blaxel API when the remote runtime cannot execute the glibc binary (e.g. Alpine).
          if (!canFallbackToBlaxelApi(method)) {
            throw error;
          }
          // If tunnel connect failed due to transient issue or unsupported image, try fallback for Files/VCS.
          if (method.startsWith("design/") || method === "skills/list") {
            throw error;
          }
          console.warn(
            `[roder-remote-tunnel] ${method} fell back to Blaxel API: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return this.handleViaBlaxelApiFallback(method, workspaceId, params);
  }

  private async requestViaTunnel(
    method: string,
    desktopWorkspaceId: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const target = await this.resolveTarget(desktopWorkspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    const tunnel = await this.tunnelManager.ensureBlaxelTunnel({
      desktopWorkspaceId,
      desktopRootName: target.rootName,
      auth: endpoint.auth,
      sandboxName: endpoint.sandboxName,
      sandboxUrl: endpoint.sandboxUrl,
      workingDir: target.workspace,
    });

    const forwardedParams = rewriteParamsToRemote(params, tunnel);
    try {
      const result = await tunnel.connection.request(method, forwardedParams);
      return rewriteResultToDesktop(method, result, {
        desktopWorkspaceId,
        desktopRootId: target.rootId,
        desktopRootName: target.rootName,
      });
    } catch (error) {
      // If the WebSocket dropped while the sandbox was in standby, wake/reconnect once and retry.
      if (!tunnel.connection.isOpen()) {
        const reconnected = await this.tunnelManager.ensureBlaxelTunnel({
          desktopWorkspaceId,
          desktopRootName: target.rootName,
          auth: endpoint.auth,
          sandboxName: endpoint.sandboxName,
          sandboxUrl: endpoint.sandboxUrl,
          workingDir: target.workspace,
        });
        const retryResult = await reconnected.connection.request(method, rewriteParamsToRemote(params, reconnected));
        return rewriteResultToDesktop(method, retryResult, {
          desktopWorkspaceId,
          desktopRootId: target.rootId,
          desktopRootName: target.rootName,
        });
      }
      throw error;
    }
  }

  private async handleViaBlaxelApiFallback(
    method: string,
    workspaceId: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "workspace/files/status") {
      return this.workspaceFilesStatus(workspaceId);
    }
    if (method === "workspace/files/rebuild") {
      return this.rebuildWorkspaceFiles(workspaceId);
    }
    if (method === "workspace/files/children") {
      return this.listWorkspaceFileChildren({
        workspaceId,
        rootId: typeof params.rootId === "string" ? params.rootId : undefined,
        path: typeof params.path === "string" ? params.path : undefined,
      });
    }
    if (method === "workspace/files/query") {
      return this.queryWorkspaceFiles({
        workspaceId,
        query: typeof params.query === "string" ? params.query : "",
        limit: typeof params.limit === "number" ? params.limit : undefined,
      });
    }
    if (method === "workspace/files/read") {
      return this.readWorkspaceFile({
        workspaceId,
        rootId: typeof params.rootId === "string" ? params.rootId : undefined,
        path: typeof params.path === "string" ? params.path : "",
        offset: typeof params.offset === "number" ? params.offset : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
      });
    }
    if (method === "vcs/changes/list") {
      return this.listVcsChanges({
        workspaceId,
        limit: typeof params.limit === "number" ? params.limit : undefined,
      });
    }
    if (method === "vcs/changes/read") {
      return this.readVcsChange({
        workspaceId,
        path: typeof params.path === "string" ? params.path : "",
        offset: typeof params.offset === "number" ? params.offset : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
        area:
          params.area === "committed" ||
          params.area === "staged" ||
          params.area === "unstaged" ||
          params.area === "untracked"
            ? params.area
            : undefined,
        ignoreWhitespace: Boolean(params.ignoreWhitespace),
      });
    }
    throw new Error(`Remote workspace method "${method}" requires the remote-roder tunnel.`);
  }

  observeThread(thread: unknown): void {
    if (!thread || typeof thread !== "object") return;
    const record = thread as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const runner = record.runner;
    if (!id || !runner || typeof runner !== "object") return;
    const runnerRecord = runner as Record<string, unknown>;
    if (
      typeof runnerRecord.providerId === "string" &&
      runnerRecord.providerId !== "unix-local" &&
      typeof runnerRecord.workspace === "string"
    ) {
      this.threadRunners.set(id, {
        providerId: runnerRecord.providerId,
        workspace: runnerRecord.workspace,
        config:
          runnerRecord.config && typeof runnerRecord.config === "object" && !Array.isArray(runnerRecord.config)
            ? (runnerRecord.config as Record<string, unknown>)
            : {},
        ...(Array.isArray(runnerRecord.readRoots)
          ? { readRoots: runnerRecord.readRoots.filter((entry): entry is string => typeof entry === "string") }
          : {}),
      });
    }
  }

  observeResponse(method: string, result: unknown): void {
    if (!result || typeof result !== "object") return;
    const record = result as Record<string, unknown>;
    if (method === "thread/list" && Array.isArray(record.data)) {
      for (const thread of record.data) {
        this.observeThread(thread);
      }
      return;
    }
    if ((method === "thread/start" || method === "thread/read" || method === "thread/history/read") && record.thread) {
      this.observeThread(record.thread);
    }
  }

  invalidateThread(threadId: string): void {
    this.pathIndexCache.delete(remoteWorkspaceIdForThread(threadId));
  }

  invalidateAll(): void {
    this.pathIndexCache.clear();
  }

  hasCachedThreadRunner(threadId: string): boolean {
    return this.threadRunners.has(threadId);
  }

  async resolveTarget(workspaceId: string): Promise<ResolvedRemoteTarget> {
    if (workspaceId.startsWith("remote:thread:")) {
      const threadId = workspaceId.slice("remote:thread:".length);
      if (!threadId) throw new Error("Missing remote thread ID.");
      let runner = this.threadRunners.get(threadId) ?? null;
      if (!runner) {
        runner = await this.options.readThreadRunner(threadId);
        if (runner) {
          this.threadRunners.set(threadId, runner);
        }
      }
      if (!runner || runner.providerId === "unix-local") {
        throw new Error("This thread is not bound to a remote workspace.");
      }
      const targetName = remoteRunnerTargetLabel(runner);
      return {
        workspaceId,
        rootId: REMOTE_WORKSPACE_ROOT_ID,
        rootName: targetName,
        providerId: runner.providerId,
        workspace: runner.workspace,
        config: runner.config ?? {},
        targetName,
      };
    }

    if (workspaceId.startsWith("remote:machine:")) {
      const machineId = workspaceId.slice("remote:machine:".length);
      if (!machineId) throw new Error("Missing cloud machine ID.");
      const profile = await this.options.machinesService.getProfile(machineId);
      return {
        workspaceId,
        rootId: REMOTE_WORKSPACE_ROOT_ID,
        rootName: profile.name,
        providerId: profile.providerId,
        workspace: profile.workspace,
        config: profile.config,
        targetName: remoteRunnerTargetLabel(profile),
      };
    }

    throw new Error(`Unsupported remote workspace identifier: ${workspaceId}`);
  }

  async resolveBlaxelEndpoint(
    runner: Pick<ThreadRunner, "providerId" | "workspace" | "config">,
  ): Promise<{ auth: BlaxelAuth; sandboxName: string; sandboxUrl: string; status: string; region: string | null }> {
    if (runner.providerId !== "blaxel") {
      throw new Error(`Direct remote workspace access is currently supported for Blaxel (got "${runner.providerId}").`);
    }
    const sandboxName = blaxelSandboxNameFromConfig(runner.config);
    if (!sandboxName) {
      throw new Error('This Blaxel profile is missing "sandbox_name" in its configuration.');
    }
    const workspaceOverride = blaxelWorkspaceFromConfig(runner.config);
    const auth = await this.options.credentialsService.resolveBlaxelAuth(workspaceOverride);
    if (!auth) {
      throw new Error("Blaxel is not connected. Connect Blaxel in Settings > Cloud Machines.");
    }
    if (!auth.workspace) {
      throw new Error("Blaxel workspace is not configured. Set it in Settings > Cloud Machines.");
    }
    const sandbox = await this.options.blaxelClient.getSandbox(auth, sandboxName);
    if (!sandbox.url) {
      throw new Error(
        `Blaxel sandbox "${sandboxName}" is ${sandbox.status.toLowerCase()} and has no endpoint URL yet.`,
      );
    }
    return {
      auth,
      sandboxName,
      sandboxUrl: sandbox.url,
      status: sandbox.status,
      region: sandbox.region,
    };
  }

  async workspaceFilesStatus(workspaceId: string): Promise<WorkspaceFilesStatusResult> {
    const target = await this.resolveTarget(workspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    await this.options.blaxelClient.wakeSandbox(endpoint.auth, endpoint.sandboxUrl);
    const cached = this.pathIndexCache.get(workspaceId);
    return { status: buildRemoteFilesStatus(target, cached) };
  }

  async rebuildWorkspaceFiles(workspaceId: string): Promise<WorkspaceFilesRebuildResult> {
    this.pathIndexCache.delete(workspaceId);
    const result = await this.workspaceFilesStatus(workspaceId);
    return { status: result.status };
  }

  async listWorkspaceFileChildren(params: {
    workspaceId: string;
    rootId?: string;
    path?: string;
  }): Promise<WorkspaceFilesChildrenResult> {
    const target = await this.resolveTarget(params.workspaceId);
    const cached = this.pathIndexCache.get(params.workspaceId);
    const status = buildRemoteFilesStatus(target, cached);

    // Top-level workspace root enumeration (matches roder app-server contract).
    if (!params.rootId && !params.path) {
      return {
        status,
        entries: [
          {
            rootId: target.rootId,
            rootName: target.rootName,
            path: "",
            name: target.rootName,
            kind: "directory",
            hasChildren: true,
          },
        ],
      };
    }

    const endpoint = await this.resolveBlaxelEndpoint(target);
    const relativeDir = normalizePosixRelativePath(params.path);
    const absDir = joinPosixWorkspacePath(target.workspace, relativeDir);
    const listing = await this.options.blaxelClient.readDirectory(endpoint.auth, endpoint.sandboxUrl, absDir);

    const directories: WorkspaceFileEntry[] = listing.subdirectories
      .filter((entry) => entry.name && entry.name !== ".git")
      .map((entry) => ({
        rootId: target.rootId,
        rootName: target.rootName,
        path: relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
        name: entry.name,
        kind: "directory" as const,
        hasChildren: true,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));

    const files: WorkspaceFileEntry[] = listing.files
      .filter((entry) => Boolean(entry.name))
      .map((entry) => ({
        rootId: target.rootId,
        rootName: target.rootName,
        path: relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
        name: entry.name,
        kind: "file" as const,
        hasChildren: false,
        size: entry.size,
        modifiedMs: entry.lastModified ? Date.parse(entry.lastModified) || null : null,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));

    return {
      status,
      entries: [...directories, ...files],
    };
  }

  async queryWorkspaceFiles(params: {
    workspaceId: string;
    query: string;
    limit?: number;
  }): Promise<WorkspaceFilesQueryResult> {
    const target = await this.resolveTarget(params.workspaceId);
    const index = await this.getOrBuildPathIndex(target);
    const status = buildRemoteFilesStatus(target, index);
    const limit = Math.max(1, Math.min(500, params.limit ?? 200));
    const matches = matchRemotePaths(target, index.entries, params.query, limit);
    return {
      status,
      matches,
      indexedFileCount: index.fileCount,
    };
  }

  async readWorkspaceFile(params: {
    workspaceId: string;
    rootId?: string;
    path: string;
    offset?: number;
    limit?: number;
  }): Promise<WorkspaceFilesReadResult> {
    const target = await this.resolveTarget(params.workspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    const relativePath = normalizePosixRelativePath(params.path);
    if (!relativePath) {
      throw new Error("A file path is required.");
    }
    const absPath = joinPosixWorkspacePath(target.workspace, relativePath);
    const { bytes } = await this.options.blaxelClient.readFile(endpoint.auth, endpoint.sandboxUrl, absPath);
    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.max(1, params.limit ?? 262_144);
    const totalBytes = bytes.length;
    const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
    const entry: WorkspaceFileEntry = {
      rootId: target.rootId,
      rootName: target.rootName,
      path: relativePath,
      name: relativePath.split("/").pop() ?? relativePath,
      kind: "file",
      hasChildren: false,
      size: totalBytes,
    };

    if (isBinaryBuffer(sample)) {
      return {
        entry,
        encoding: "binary",
        offset: 0,
        limit,
        totalBytes,
        hasMore: false,
        truncated: false,
      };
    }

    const slice = bytes.subarray(offset, offset + limit);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    const hasMore = offset + slice.length < totalBytes;
    return {
      entry,
      encoding: "utf8",
      text,
      offset,
      limit,
      totalBytes,
      hasMore,
      truncated: hasMore,
    };
  }

  async listVcsChanges(params: { workspaceId: string; limit?: number }): Promise<VcsChangesListResult> {
    const target = await this.resolveTarget(params.workspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    const script = [
      'if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "===RODER_NOT_GIT==="; exit 0; fi',
      'echo "===RODER_ROOT==="',
      "git rev-parse --show-toplevel 2>/dev/null || pwd",
      'echo "===RODER_BRANCH==="',
      'git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "(unborn)"',
      'echo "===RODER_BASE==="',
      "git rev-parse --abbrev-ref @{upstream} 2>/dev/null || true",
      'echo "===RODER_STATUS==="',
      "git status --porcelain=v1 -uall",
      'echo "===RODER_STAGED_NUMSTAT==="',
      "git diff --cached --numstat",
      'echo "===RODER_UNSTAGED_NUMSTAT==="',
      "git diff --numstat",
      'echo "===RODER_UNTRACKED_COUNTS==="',
      'git ls-files --others --exclude-standard | head -n 300 | while IFS= read -r f; do if [ -f "$f" ]; then c=$(wc -l < "$f" 2>/dev/null || echo 0); printf "%s\\t%s\\n" "$c" "$f"; fi; done',
    ].join("\n");

    const proc = await this.options.blaxelClient.runProcess(endpoint.auth, endpoint.sandboxUrl, {
      command: `sh -c ${shellQuotePosix(script)}`,
      workingDir: target.workspace,
      timeoutMs: 20_000,
    });
    const output = proc.stdout || proc.logs || "";
    if (output.includes("===RODER_NOT_GIT===")) {
      throw new Error(`No Git repository found in ${target.workspace}.`);
    }
    return parseRemoteGitStatusOutput(output, target.workspace, params.limit);
  }

  async readVcsChange(params: {
    workspaceId: string;
    path: string;
    offset?: number;
    limit?: number;
    area?: VcsChangeArea;
    ignoreWhitespace?: boolean;
  }): Promise<VcsChangesReadResult> {
    const target = await this.resolveTarget(params.workspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    const relativePath = normalizePosixRelativePath(params.path);
    if (!relativePath) {
      throw new Error("A changed file path is required.");
    }
    const quotedPath = shellQuotePosix(relativePath);
    const wsFlag = params.ignoreWhitespace ? "-w" : "";
    let command: string;
    if (params.area === "staged") {
      command = `git diff --cached --no-color ${wsFlag} -- ${quotedPath}`;
    } else if (params.area === "unstaged") {
      command = `git diff --no-color ${wsFlag} -- ${quotedPath}`;
    } else if (params.area === "untracked") {
      command = `git diff --no-index --no-color -- /dev/null ${quotedPath} || true`;
    } else {
      command = [
        `if git ls-files --others --exclude-standard -- ${quotedPath} | grep -q .; then`,
        `  git diff --no-index --no-color -- /dev/null ${quotedPath} || true;`,
        `elif git rev-parse --verify HEAD >/dev/null 2>&1; then`,
        `  git diff HEAD --no-color ${wsFlag} -- ${quotedPath};`,
        `else`,
        `  git diff --cached --no-color ${wsFlag} -- ${quotedPath};`,
        `fi`,
      ].join(" ");
    }

    const proc = await this.options.blaxelClient.runProcess(endpoint.auth, endpoint.sandboxUrl, {
      command: `sh -c ${shellQuotePosix(command)}`,
      workingDir: target.workspace,
      timeoutMs: 20_000,
    });
    const rawPatch = proc.stdout || proc.logs || "";
    return paginateUnifiedDiff(relativePath, rawPatch, params.offset ?? 0, params.limit ?? 20_000);
  }

  async testProfile(input: {
    providerId: string;
    workspace: string;
    config: Record<string, unknown>;
  }): Promise<{ ok: boolean; status: string; sandboxUrl?: string; directoryExists?: boolean; message: string }> {
    const endpoint = await this.resolveBlaxelEndpoint({
      providerId: input.providerId,
      workspace: input.workspace,
      config: input.config,
    });
    await this.options.blaxelClient.wakeSandbox(endpoint.auth, endpoint.sandboxUrl);
    let directoryExists = true;
    try {
      await this.options.blaxelClient.readDirectory(endpoint.auth, endpoint.sandboxUrl, input.workspace);
    } catch {
      directoryExists = false;
    }
    return {
      ok: true,
      status: endpoint.status,
      sandboxUrl: endpoint.sandboxUrl,
      directoryExists,
      message: directoryExists
        ? `Connected to ${endpoint.sandboxName} (${endpoint.region ?? "Blaxel"}) · ${input.workspace} ready.`
        : `Connected to ${endpoint.sandboxName}, but ${input.workspace} does not exist yet (it will be created on first run).`,
    };
  }

  async getStatus(workspaceId: string): Promise<RemoteRunnerStatusSnapshot> {
    const target = await this.resolveTarget(workspaceId);
    if (target.providerId !== "blaxel") {
      return {
        workspaceId,
        providerId: target.providerId,
        targetName: target.targetName,
        workspace: target.workspace,
        status: "CONNECTED",
        reachable: true,
      };
    }
    try {
      const endpoint = await this.resolveBlaxelEndpoint(target);
      const key = tunnelKey("blaxel", endpoint.auth.workspace, endpoint.sandboxName, target.workspace);
      const activeTunnel = this.tunnelManager.getActiveTunnel(key);
      const unsupportedReason = this.tunnelManager.isUnsupported(key);
      return {
        workspaceId,
        providerId: target.providerId,
        targetName: endpoint.sandboxName,
        workspace: target.workspace,
        blaxelWorkspace: endpoint.auth.workspace,
        status: endpoint.status,
        region: endpoint.region,
        url: endpoint.sandboxUrl,
        reachable: true,
        bridgeMode: activeTunnel ? "remote-roder-tunnel" : unsupportedReason ? "blaxel-api" : "pending",
        bridgeDetail: activeTunnel
          ? `remote-roder WSS tunnel (${activeTunnel.remoteWorkspaceId})`
          : (unsupportedReason ?? "Tunnel connects automatically when workspace tools open"),
      };
    } catch (error) {
      return {
        workspaceId,
        providerId: target.providerId,
        targetName: target.targetName,
        workspace: target.workspace,
        status: "UNAVAILABLE",
        reachable: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async wake(workspaceId: string): Promise<RemoteRunnerStatusSnapshot> {
    const target = await this.resolveTarget(workspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    await this.options.blaxelClient.wakeSandbox(endpoint.auth, endpoint.sandboxUrl);
    if (!this.options.disableTunnel) {
      await this.tunnelManager
        .ensureBlaxelTunnel({
          desktopWorkspaceId: workspaceId,
          desktopRootName: target.rootName,
          auth: endpoint.auth,
          sandboxName: endpoint.sandboxName,
          sandboxUrl: endpoint.sandboxUrl,
          workingDir: target.workspace,
        })
        .catch(() => undefined);
    }
    return this.getStatus(workspaceId);
  }

  async openPreviewPort(workspaceId: string, port: number): Promise<{ url: string; port: number }> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be a number between 1 and 65535.");
    }
    const target = await this.resolveTarget(workspaceId);
    const endpoint = await this.resolveBlaxelEndpoint(target);
    await this.options.blaxelClient.wakeSandbox(endpoint.auth, endpoint.sandboxUrl);
    const preview = await this.options.blaxelClient.createPreview(endpoint.auth, endpoint.sandboxName, port);
    return { url: preview.url, port };
  }

  private async getOrBuildPathIndex(target: ResolvedRemoteTarget): Promise<CachedPathIndex> {
    const cached = this.pathIndexCache.get(target.workspaceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    const endpoint = await this.resolveBlaxelEndpoint(target);
    const pruneArgs = [...SKIPPED_DIRECTORY_NAMES].map((name) => `-name ${shellQuotePosix(name)}`).join(" -o ");
    const script = [
      `find . -maxdepth 7 \\( ${pruneArgs} \\) -prune -o -type d -print`,
      'echo "===RODER_FILES==="',
      `find . -maxdepth 7 \\( ${pruneArgs} \\) -prune -o -type f -print`,
    ].join("\n");
    const proc = await this.options.blaxelClient.runProcess(endpoint.auth, endpoint.sandboxUrl, {
      command: `sh -c ${shellQuotePosix(script)}`,
      workingDir: target.workspace,
      timeoutMs: 20_000,
    });
    const output = proc.stdout || proc.logs || "";
    const parsed = parseFindIndexOutput(output);
    const index: CachedPathIndex = {
      ...parsed,
      expiresAt: Date.now() + INDEX_CACHE_TTL_MS,
    };
    this.pathIndexCache.set(target.workspaceId, index);
    return index;
  }
}

function buildRemoteFilesStatus(target: ResolvedRemoteTarget, cached?: CachedPathIndex): WorkspaceFilesStatus {
  const fileCount = cached?.fileCount ?? 0;
  const directoryCount = cached?.directoryCount ?? 0;
  return {
    workspaceId: target.workspaceId,
    state: "ready",
    stale: false,
    roots: [
      {
        rootId: target.rootId,
        id: target.rootId,
        name: target.rootName,
        path: target.workspace,
        state: "ready",
        stale: false,
        fileCount,
        directoryCount,
      },
    ],
    fileCount,
    directoryCount,
  };
}

export function parseFindIndexOutput(output: string): {
  entries: IndexedRemoteEntry[];
  fileCount: number;
  directoryCount: number;
} {
  const marker = "===RODER_FILES===";
  const markerIndex = output.indexOf(marker);
  const dirsPart = markerIndex === -1 ? "" : output.slice(0, markerIndex);
  const filesPart = markerIndex === -1 ? output : output.slice(markerIndex + marker.length);
  const entries: IndexedRemoteEntry[] = [];
  let fileCount = 0;
  let directoryCount = 0;

  for (const raw of dirsPart.split(/\r?\n/u)) {
    const cleaned = raw.trim().replace(/^\.\//u, "");
    if (!cleaned || cleaned === ".") continue;
    directoryCount += 1;
    entries.push({ path: cleaned, name: cleaned.split("/").pop() ?? cleaned, kind: "directory" });
  }
  for (const raw of filesPart.split(/\r?\n/u)) {
    const cleaned = raw.trim().replace(/^\.\//u, "");
    if (!cleaned || cleaned === ".") continue;
    fileCount += 1;
    entries.push({ path: cleaned, name: cleaned.split("/").pop() ?? cleaned, kind: "file" });
  }
  return { entries, fileCount, directoryCount };
}

export function matchRemotePaths(
  target: Pick<ResolvedRemoteTarget, "rootId" | "rootName">,
  entries: readonly IndexedRemoteEntry[],
  rawQuery: string,
  limit: number,
): WorkspaceFilesQueryMatch[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const terms = query.split(/\s+/u).filter(Boolean);
  const scored: WorkspaceFilesQueryMatch[] = [];

  for (const item of entries) {
    const lowerPath = item.path.toLowerCase();
    const lowerName = item.name.toLowerCase();
    const score = scorePathMatch(lowerPath, lowerName, query, terms);
    if (score <= 0) continue;
    scored.push({
      entry: {
        rootId: target.rootId,
        rootName: target.rootName,
        path: item.path,
        name: item.name,
        kind: item.kind,
        hasChildren: item.kind === "directory",
      },
      score: score + (item.kind === "file" ? 5 : 0),
      matchPositions: computeMatchPositions(lowerPath, query),
    });
  }

  return scored
    .toSorted((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
    .slice(0, limit);
}

function scorePathMatch(lowerPath: string, lowerName: string, query: string, terms: readonly string[]): number {
  if (lowerName === query) return 1000;
  if (lowerName.startsWith(query)) return 850 - lowerPath.length * 0.1;
  const nameIdx = lowerName.indexOf(query);
  if (nameIdx !== -1) return 700 - nameIdx * 2 - lowerPath.length * 0.1;
  const pathIdx = lowerPath.indexOf(query);
  if (pathIdx !== -1) return 550 - pathIdx - lowerPath.length * 0.1;
  if (terms.length > 1 && terms.every((term) => lowerPath.includes(term))) {
    return 450 - lowerPath.length * 0.1;
  }
  // Subsequence fuzzy match
  let qi = 0;
  for (let pi = 0; pi < lowerPath.length && qi < query.length; pi += 1) {
    if (lowerPath[pi] === query[qi]) qi += 1;
  }
  if (qi === query.length) {
    return 200 - lowerPath.length * 0.2;
  }
  return 0;
}

function computeMatchPositions(lowerPath: string, query: string): number[] {
  const directIdx = lowerPath.indexOf(query);
  if (directIdx !== -1) {
    return Array.from({ length: query.length }, (_, offset) => directIdx + offset);
  }
  const positions: number[] = [];
  let qi = 0;
  for (let pi = 0; pi < lowerPath.length && qi < query.length; pi += 1) {
    if (lowerPath[pi] === query[qi]) {
      positions.push(pi);
      qi += 1;
    }
  }
  return positions;
}

export function isBinaryBuffer(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  if (bytes.includes(0)) return true;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return decoded.includes("\uFFFD");
}

export function parseRemoteGitStatusOutput(output: string, fallbackRoot: string, limit?: number): VcsChangesListResult {
  const sections = splitSentinelSections(output, [
    "===RODER_ROOT===",
    "===RODER_BRANCH===",
    "===RODER_BASE===",
    "===RODER_STATUS===",
    "===RODER_STAGED_NUMSTAT===",
    "===RODER_UNSTAGED_NUMSTAT===",
    "===RODER_UNTRACKED_COUNTS===",
  ]);

  const repoRoot = sections["===RODER_ROOT==="]?.trim() || fallbackRoot;
  const branch = sections["===RODER_BRANCH==="]?.trim() || null;
  const baseRef = sections["===RODER_BASE==="]?.trim() || null;
  const stagedStats = parseNumstat(sections["===RODER_STAGED_NUMSTAT==="] ?? "");
  const unstagedStats = parseNumstat(sections["===RODER_UNSTAGED_NUMSTAT==="] ?? "");
  const untrackedLines = parseUntrackedCounts(sections["===RODER_UNTRACKED_COUNTS==="] ?? "");

  const files: VcsChangedFile[] = [];
  for (const rawLine of (sections["===RODER_STATUS==="] ?? "").split(/\r?\n/u)) {
    if (rawLine.length < 4) continue;
    const x = rawLine[0];
    const y = rawLine[1];
    const pathPart = rawLine.slice(3);
    if (!pathPart) continue;

    let path = unquoteGitPath(pathPart);
    let oldPath: string | null = null;
    if ((x === "R" || y === "R" || x === "C") && pathPart.includes(" -> ")) {
      const [from, to] = pathPart.split(" -> ");
      oldPath = unquoteGitPath(from);
      path = unquoteGitPath(to);
    }

    const areas: VcsChangeArea[] = [];
    let status: VcsChangeStatus = "modified";

    if (x === "?" && y === "?") {
      status = "untracked";
      areas.push("untracked");
    } else {
      if (x !== " " && x !== "?") {
        areas.push("staged");
      }
      if (y !== " " && y !== "?") {
        areas.push("unstaged");
      }
      if (x === "R" || y === "R") status = "renamed";
      else if (x === "A" || y === "A") status = "added";
      else if (x === "D" || y === "D") status = "deleted";
      else status = "modified";
    }

    const staged = stagedStats.get(path);
    const unstaged = unstagedStats.get(path);
    const untrackedAdd = status === "untracked" ? (untrackedLines.get(path) ?? 0) : 0;
    const additions = (staged?.additions ?? 0) + (unstaged?.additions ?? 0) + untrackedAdd;
    const deletions = (staged?.deletions ?? 0) + (unstaged?.deletions ?? 0);
    const binary = Boolean(staged?.binary || unstaged?.binary);

    files.push({
      path,
      oldPath,
      status,
      areas,
      additions,
      deletions,
      binary,
    });
  }

  const maxFiles = limit && limit > 0 ? limit : files.length;
  const truncated = files.length > maxFiles;
  const visibleFiles = truncated ? files.slice(0, maxFiles) : files;
  const totals = visibleFiles.reduce(
    (acc, file) => ({
      files: acc.files + 1,
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );

  return {
    status: {
      provider: { id: "git", displayName: "Git (Remote)" },
      workspace: { root: repoRoot, id: REMOTE_WORKSPACE_ROOT_ID },
      activeLine: branch ? { id: branch, name: branch, kind: "branch" } : null,
      base: baseRef ? { refName: baseRef, sha: null } : null,
      changedFileCount: files.length,
    },
    files: visibleFiles,
    totals,
    truncated,
  };
}

export function paginateUnifiedDiff(
  path: string,
  rawPatch: string,
  offset: number,
  limit: number,
): VcsChangesReadResult {
  const binary = /^Binary files .* differ$/mu.test(rawPatch) || /^GIT binary patch$/mu.test(rawPatch);
  if (binary) {
    return {
      path,
      content: null,
      offset: 0,
      totalLines: 0,
      nextOffset: null,
      binary: true,
    };
  }
  const normalized = rawPatch.replace(/\r\n/gu, "\n");
  if (!normalized.trim()) {
    return {
      path,
      content: "",
      offset: 0,
      totalLines: 0,
      nextOffset: null,
      binary: false,
    };
  }
  const lines = normalized.split("\n");
  const start = Math.max(0, offset);
  const end = Math.min(lines.length, start + Math.max(1, limit));
  const slice = lines.slice(start, end).join("\n");
  return {
    path,
    content: slice,
    offset: start,
    totalLines: lines.length,
    nextOffset: end < lines.length ? end : null,
    binary: false,
  };
}

function splitSentinelSections(text: string, sentinels: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const positions = sentinels
    .map((sentinel) => ({ sentinel, index: text.indexOf(sentinel) }))
    .filter((entry) => entry.index !== -1)
    .toSorted((left, right) => left.index - right.index);

  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const next = positions[i + 1];
    const start = current.index + current.sentinel.length;
    const end = next ? next.index : text.length;
    result[current.sentinel] = text.slice(start, end).replace(/^\r?\n/u, "");
  }
  return result;
}

function parseNumstat(text: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const map = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const line of text.split(/\r?\n/u)) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addRaw, delRaw, ...pathRest] = parts;
    const rawPath = pathRest.join("\t").trim();
    if (!rawPath) continue;
    const path = normalizeRenamedNumstatPath(rawPath);
    const binary = addRaw === "-" || delRaw === "-";
    const additions = binary ? 0 : Number.parseInt(addRaw, 10) || 0;
    const deletions = binary ? 0 : Number.parseInt(delRaw, 10) || 0;
    const prev = map.get(path);
    map.set(path, {
      additions: (prev?.additions ?? 0) + additions,
      deletions: (prev?.deletions ?? 0) + deletions,
      binary: Boolean(prev?.binary || binary),
    });
  }
  return map;
}

function normalizeRenamedNumstatPath(rawPath: string): string {
  // Handle git rename formats like `a/{old => new}/file.ts` or `old => new`.
  const braceMatch = /^(.*)\{.* => (.*)\}(.*)$/u.exec(rawPath);
  if (braceMatch) {
    return `${braceMatch[1]}${braceMatch[2]}${braceMatch[3]}`.replace(/\/+/gu, "/");
  }
  if (rawPath.includes(" => ")) {
    return rawPath.split(" => ").pop()!.trim();
  }
  return unquoteGitPath(rawPath);
}

function parseUntrackedCounts(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split(/\r?\n/u)) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const count = Number.parseInt(line.slice(0, tab).trim(), 10) || 0;
    const path = line.slice(tab + 1).trim();
    if (path) map.set(path, count);
  }
  return map;
}

function canFallbackToBlaxelApi(method: string): boolean {
  return (
    method === "workspace/files/status" ||
    method === "workspace/files/rebuild" ||
    method === "workspace/files/children" ||
    method === "workspace/files/query" ||
    method === "workspace/files/read" ||
    method === "vcs/changes/list" ||
    method === "vcs/changes/read"
  );
}

function rewriteParamsToRemote(params: Record<string, unknown>, tunnel: ActiveRemoteTunnel): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...params,
    workspaceId: tunnel.remoteWorkspaceId,
  };
  if (typeof params.rootId === "string" && params.rootId) {
    next.rootId = tunnel.remoteRootId;
  }
  return next;
}

function rewriteResultToDesktop(
  method: string,
  result: unknown,
  desktop: { desktopWorkspaceId: string; desktopRootId: string; desktopRootName: string },
): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;

  if (method === "workspace/files/status" || method === "workspace/files/rebuild") {
    if (record.status && typeof record.status === "object") {
      return {
        ...record,
        status: rewriteRemoteFilesStatus(
          record.status as Record<string, unknown>,
          desktop.desktopWorkspaceId,
          desktop.desktopRootId,
          desktop.desktopRootName,
        ),
      };
    }
    return record;
  }

  if (method === "workspace/files/children") {
    return {
      ...record,
      ...(record.status && typeof record.status === "object"
        ? {
            status: rewriteRemoteFilesStatus(
              record.status as Record<string, unknown>,
              desktop.desktopWorkspaceId,
              desktop.desktopRootId,
              desktop.desktopRootName,
            ),
          }
        : {}),
      entries: Array.isArray(record.entries)
        ? record.entries.map((entry) =>
            entry && typeof entry === "object"
              ? rewriteRemoteFileEntry(entry as Record<string, unknown>, desktop.desktopRootId, desktop.desktopRootName)
              : entry,
          )
        : [],
    };
  }

  if (method === "workspace/files/query") {
    return {
      ...record,
      ...(record.status && typeof record.status === "object"
        ? {
            status: rewriteRemoteFilesStatus(
              record.status as Record<string, unknown>,
              desktop.desktopWorkspaceId,
              desktop.desktopRootId,
              desktop.desktopRootName,
            ),
          }
        : {}),
      matches: Array.isArray(record.matches)
        ? record.matches.map((match) => {
            if (!match || typeof match !== "object") return match;
            const m = match as Record<string, unknown>;
            return {
              ...m,
              ...(m.entry && typeof m.entry === "object"
                ? {
                    entry: rewriteRemoteFileEntry(
                      m.entry as Record<string, unknown>,
                      desktop.desktopRootId,
                      desktop.desktopRootName,
                    ),
                  }
                : {}),
            };
          })
        : [],
    };
  }

  if (method === "workspace/files/read") {
    return {
      ...record,
      ...(record.entry && typeof record.entry === "object"
        ? {
            entry: rewriteRemoteFileEntry(
              record.entry as Record<string, unknown>,
              desktop.desktopRootId,
              desktop.desktopRootName,
            ),
          }
        : {}),
    };
  }

  if (method === "vcs/changes/list" && record.status && typeof record.status === "object") {
    const statusRecord = record.status as Record<string, unknown>;
    const workspaceRecord =
      statusRecord.workspace && typeof statusRecord.workspace === "object"
        ? (statusRecord.workspace as Record<string, unknown>)
        : null;
    return {
      ...record,
      status: {
        ...statusRecord,
        ...(workspaceRecord ? { workspace: { ...workspaceRecord, id: desktop.desktopRootId } } : {}),
      },
    };
  }

  return record;
}

function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
  return trimmed;
}
