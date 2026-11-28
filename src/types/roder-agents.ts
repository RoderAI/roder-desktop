export type RoderAgentWake = { id: string; at: number; reason: string };
export type RoderAgent = {
  id: string;
  name: string;
  /** One-line summary for lists. It mirrors the opening paragraph of INSTRUCTIONS.md once that is written. */
  mission: string;
  workspaceId: string;
  threadId: string;
  modelProvider?: string;
  model?: string;
  reasoning?: string;
  enabled: boolean;
  intervalMinutes: number;
  eventMethods: string[];
  maxRunsPerDay: number;
  maxRunMinutes: number;
  runs: number[];
  wakes: RoderAgentWake[];
  active: { turnId: string | null; startedAt: number } | null;
  lastError: string | null;
  lastRunAt: number | null;
  sprite: RoderAgentSprite | null;
};

/** The five reserved files every Roder has, in display order. */
export const roderFilePaths = ["INSTRUCTIONS.md", "AGENTS.md", "NOTES.md", "WORKERS.md", "DIGEST.md"] as const;
export type RoderFilePath = (typeof roderFilePaths)[number];
/** Who wrote a version: the user (UI) or the Roder's own thread. */
export type RoderFileAuthor = "user" | "roder";
export type RoderFileVersion = {
  path: RoderFilePath;
  version: number;
  bytes: number;
  author: RoderFileAuthor;
  writtenAt: number;
  /** The version this one copied, when it was written by a restore. */
  restoredFrom: number | null;
};
export type RoderFile = RoderFileVersion & { content: string };

export type RoderAgentDetail = RoderAgent & { files: RoderFileVersion[] };
export type RoderAgentCreate = Pick<
  RoderAgent,
  "name" | "mission" | "workspaceId" | "modelProvider" | "model" | "reasoning"
>;
export type RoderAgentPromote = RoderAgentCreate & { threadId: string };
export type RoderAgentUpdate = Partial<
  Pick<RoderAgent, "name" | "enabled" | "intervalMinutes" | "eventMethods" | "maxRunsPerDay" | "maxRunMinutes">
> & { id: string };
export type RoderFileWrite = { id: string; path: RoderFilePath; content: string; expectedVersion: number };
export type RoderFileRestore = { id: string; path: RoderFilePath; version: number; expectedVersion: number };
import type { RoderAgentSprite } from "./roder-agent-sprite";
