import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export type ClaudeCliStatus = {
  /** A `claude` executable exists on the PATH or in a common install folder. */
  installed: boolean;
  /** It resolves on the PATH the app-server inherits, which is what inference needs. */
  onPath: boolean;
  /** `claude --version` starts and exits cleanly, so the file is a working CLI and not a broken shim. */
  runnable: boolean;
  path: string | null;
};

type FindClaudeCliOptions = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDir: string;
};

const versionCheckTimeoutMs = 5000;

/** Install locations a user commonly has even when the Electron launch PATH does not include them. */
function commonInstallDirs(homeDir: string): string[] {
  return [
    join(homeDir, ".local", "bin"),
    join(homeDir, ".claude", "local"),
    join(homeDir, ".npm-global", "bin"),
    join(homeDir, ".volta", "bin"),
    join(homeDir, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    if (platform !== "win32") {
      accessSync(file, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function locateClaudeCli({ env, platform, homeDir }: FindClaudeCliOptions): { path: string; onPath: boolean } | null {
  const binaryName = platform === "win32" ? "claude.exe" : "claude";
  const pathDirs = (env.PATH ?? "").split(delimiter).filter((dir) => dir.length > 0);

  for (const dir of pathDirs) {
    const file = join(dir, binaryName);
    if (isExecutableFile(file, platform)) {
      return { path: file, onPath: true };
    }
  }

  for (const dir of commonInstallDirs(homeDir)) {
    const file = join(dir, binaryName);
    if (isExecutableFile(file, platform)) {
      return { path: file, onPath: false };
    }
  }

  return null;
}

function canRunVersion(file: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(file, ["--version"], { env, timeout: versionCheckTimeoutMs }, (error) => {
      resolve(error === null);
    });
  });
}

export async function findClaudeCli(options: FindClaudeCliOptions): Promise<ClaudeCliStatus> {
  const located = locateClaudeCli(options);
  if (!located) {
    return { installed: false, onPath: false, runnable: false, path: null };
  }
  const runnable = await canRunVersion(located.path, options.env);
  return { installed: true, onPath: located.onPath, runnable, path: located.path };
}
