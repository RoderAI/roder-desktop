import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type BlaxelCliStatus = {
  installed: boolean;
  authenticated: boolean;
  workspace: string | null;
  workspaces: string[];
  binaryPath: string | null;
};

export type ParsedBlaxelConfig = {
  activeWorkspace: string | null;
  workspaces: Array<{
    name: string;
    apiKey?: string;
    accessToken?: string;
  }>;
};

export type BlaxelCliOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  execToken?: (binaryPath: string, workspace?: string) => Promise<string | null>;
};

export function parseBlaxelConfigYaml(yamlText: string): ParsedBlaxelConfig {
  const lines = yamlText.split(/\r?\n/u);
  let section: "root" | "context" | "workspaces" = "root";
  let activeWorkspace: string | null = null;
  const workspaces: ParsedBlaxelConfig["workspaces"] = [];
  let currentWorkspace: ParsedBlaxelConfig["workspaces"][number] | null = null;
  let credentialsIndent: number | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;

    if (indent === 0 && !(section === "workspaces" && trimmed.startsWith("- "))) {
      credentialsIndent = null;
      currentWorkspace = null;
      if (trimmed === "context:") {
        section = "context";
      } else if (trimmed === "workspaces:") {
        section = "workspaces";
      } else {
        section = "root";
      }
      continue;
    }

    if (section === "context") {
      const match = /^workspace:\s*(.+)$/u.exec(trimmed);
      if (match) {
        activeWorkspace = unquoteYamlValue(match[1]);
      }
      continue;
    }

    if (section === "workspaces") {
      if (trimmed.startsWith("- ")) {
        credentialsIndent = null;
        currentWorkspace = { name: "" };
        workspaces.push(currentWorkspace);
        const rest = trimmed.slice(2).trim();
        applyWorkspaceField(currentWorkspace, rest);
        if (rest === "credentials:") credentialsIndent = indent + 2;
        continue;
      }
      if (!currentWorkspace) continue;
      if (trimmed === "credentials:") {
        credentialsIndent = indent;
        continue;
      }
      if (credentialsIndent !== null && indent > credentialsIndent) {
        const apiKeyMatch = /^apiKey:\s*(.+)$/u.exec(trimmed);
        if (apiKeyMatch) {
          currentWorkspace.apiKey = unquoteYamlValue(apiKeyMatch[1]);
          continue;
        }
        const accessTokenMatch = /^(?:access_token|accessToken|token):\s*(.+)$/u.exec(trimmed);
        if (accessTokenMatch) {
          currentWorkspace.accessToken = unquoteYamlValue(accessTokenMatch[1]);
          continue;
        }
      }
      if (credentialsIndent !== null && indent <= credentialsIndent) {
        credentialsIndent = null;
      }
      applyWorkspaceField(currentWorkspace, trimmed);
    }
  }

  return {
    activeWorkspace: activeWorkspace || workspaces.find((entry) => entry.name)?.name || null,
    workspaces: workspaces.filter((entry) => Boolean(entry.name)),
  };
}

function applyWorkspaceField(target: ParsedBlaxelConfig["workspaces"][number], line: string): void {
  const nameMatch = /^name:\s*(.+)$/u.exec(line);
  if (nameMatch) {
    target.name = unquoteYamlValue(nameMatch[1]);
  }
}

function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function findBlaxelBinary(options: Pick<BlaxelCliOptions, "homeDir" | "env" | "platform"> = {}): string | null {
  const home = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executable = platform === "win32" ? "bl.exe" : "bl";
  const pathEntries = (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const candidates = [
    ...pathEntries.map((dir) => join(dir, executable)),
    join(home, ".local", "bin", executable),
    join(home, ".blaxel", "bin", executable),
    "/opt/homebrew/bin/bl",
    "/usr/local/bin/bl",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function runBlToken(binaryPath: string, workspace?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ["token", "--skip-version-warning"];
    if (workspace) {
      args.push("-w", workspace);
    }
    execFile(binaryPath, args, { encoding: "utf8", timeout: 8_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const token = stdout.trim();
      resolve(token || null);
    });
  });
}

async function readBlaxelConfigFile(homeDir: string): Promise<ParsedBlaxelConfig | null> {
  const configPath = join(homeDir, ".blaxel", "config.yaml");
  try {
    const text = await readFile(configPath, "utf8");
    return parseBlaxelConfigYaml(text);
  } catch {
    return null;
  }
}

export async function detectBlaxelCli(options: BlaxelCliOptions = {}): Promise<BlaxelCliStatus> {
  const home = options.homeDir ?? homedir();
  const binaryPath = findBlaxelBinary(options);
  const config = await readBlaxelConfigFile(home);
  const workspaces = config?.workspaces.map((entry) => entry.name) ?? [];
  const activeWorkspace = config?.activeWorkspace ?? workspaces[0] ?? null;
  const hasConfigCred = Boolean(config?.workspaces.some((entry) => Boolean(entry.apiKey || entry.accessToken)));
  return {
    installed: Boolean(binaryPath),
    authenticated: hasConfigCred,
    workspace: activeWorkspace,
    workspaces,
    binaryPath,
  };
}

export async function readBlaxelCliCredentials(
  requestedWorkspace?: string,
  options: BlaxelCliOptions = {},
): Promise<{ apiKey: string; workspace: string } | null> {
  const home = options.homeDir ?? homedir();
  const config = await readBlaxelConfigFile(home);
  const targetWorkspace = requestedWorkspace?.trim() || config?.activeWorkspace || config?.workspaces[0]?.name || "";
  const entry = config?.workspaces.find((candidate) => candidate.name === targetWorkspace) ?? config?.workspaces[0];

  if (entry?.apiKey) {
    return { apiKey: entry.apiKey, workspace: entry.name || targetWorkspace };
  }

  const binaryPath = findBlaxelBinary(options);
  if (binaryPath) {
    const tokenReader = options.execToken ?? runBlToken;
    const token = await tokenReader(binaryPath, targetWorkspace || undefined);
    if (token) {
      return { apiKey: token, workspace: targetWorkspace };
    }
  }

  if (entry?.accessToken) {
    return { apiKey: entry.accessToken, workspace: entry.name || targetWorkspace };
  }
  return null;
}
