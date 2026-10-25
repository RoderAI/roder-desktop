export type PersistentAgentWake = { id: string; at: number; reason: string };
export type PersistentAgent = {
  id: string;
  name: string;
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
  wakes: PersistentAgentWake[];
  active: { turnId: string | null; startedAt: number } | null;
  lastError: string | null;
  lastRunAt: number | null;
  sprite: PersistentAgentSprite | null;
};

export type PersistentAgentDetail = PersistentAgent & { memory: string; memoryPath: string };
export type PersistentAgentCreate = Pick<
  PersistentAgent,
  "name" | "mission" | "workspaceId" | "modelProvider" | "model" | "reasoning"
>;
export type PersistentAgentPromote = PersistentAgentCreate & { threadId: string };
export type PersistentAgentUpdate = Partial<
  Pick<
    PersistentAgent,
    "name" | "mission" | "enabled" | "intervalMinutes" | "eventMethods" | "maxRunsPerDay" | "maxRunMinutes"
  >
> & { id: string; memory?: string; expectedMemory?: string };
import type { PersistentAgentSprite } from "./persistent-agent-sprite";
