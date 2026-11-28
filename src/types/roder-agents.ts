export type RoderAgentWake = { id: string; at: number; reason: string };
export type RoderAgent = {
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
  wakes: RoderAgentWake[];
  active: { turnId: string | null; startedAt: number } | null;
  lastError: string | null;
  lastRunAt: number | null;
  sprite: RoderAgentSprite | null;
};

export type RoderAgentDetail = RoderAgent & { memory: string; memoryPath: string };
export type RoderAgentCreate = Pick<
  RoderAgent,
  "name" | "mission" | "workspaceId" | "modelProvider" | "model" | "reasoning"
>;
export type RoderAgentPromote = RoderAgentCreate & { threadId: string };
export type RoderAgentUpdate = Partial<
  Pick<
    RoderAgent,
    "name" | "mission" | "enabled" | "intervalMinutes" | "eventMethods" | "maxRunsPerDay" | "maxRunMinutes"
  >
> & { id: string; memory?: string; expectedMemory?: string };
import type { RoderAgentSprite } from "./roder-agent-sprite";
