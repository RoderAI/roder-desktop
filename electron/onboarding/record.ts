import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const onboardingRecordFileName = "desktop-onboarding.json";

export type OnboardingRecord = {
  onboarded: boolean;
  completedAt: string | null;
};

const notOnboarded: OnboardingRecord = { onboarded: false, completedAt: null };

/** The flag lives beside the backend's own state, honouring RODER_CONFIG_DIR like the backend does. */
export function onboardingRecordPath(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env.RODER_CONFIG_DIR?.trim();
  return join(configured ? configured : join(homeDir, ".roder"), onboardingRecordFileName);
}

/** A missing, unreadable, or malformed file means "not onboarded", so the flow shows again rather than hiding. */
export async function readOnboardingRecord(path: string): Promise<OnboardingRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return notOnboarded;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return notOnboarded;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || record.onboarded !== true) {
    return notOnboarded;
  }
  return {
    onboarded: true,
    completedAt: typeof record.completed_at === "string" ? record.completed_at : null,
  };
}

/** Writes the flag atomically, so a crash mid-write cannot leave a half-written file behind. */
export async function writeOnboardingRecord(path: string, completedAt: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = `${JSON.stringify({ version: 1, onboarded: true, completed_at: completedAt }, null, 2)}\n`;
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, body, { mode: 0o600 });
  await rename(temp, path);
}
