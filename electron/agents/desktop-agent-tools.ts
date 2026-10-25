export type DesktopToolContext = { threadId: string; turnId: string; requestId: string };
export type DesktopAgentTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (args: unknown, context: DesktopToolContext) => Promise<unknown>;
};

type ToolOutput = { output: string; isError: boolean };

export class DesktopAgentTools {
  private readonly results = new Map<string, Promise<ToolOutput>>();

  constructor(
    private readonly tools: DesktopAgentTool[],
    private readonly request: (method: string, params: unknown) => Promise<unknown>,
  ) {}

  threadStartParams(params: unknown): Record<string, unknown> {
    const input = isRecord(params) ? params : {};
    const names = new Set(this.tools.map((tool) => tool.name));
    const existing = Array.isArray(input.externalTools) ? input.externalTools : [];
    return {
      ...input,
      externalTools: [
        ...existing.filter((tool) => !isRecord(tool) || !names.has(String(tool.name))),
        ...this.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      ],
    };
  }

  async onNotification(method: string, params: unknown): Promise<boolean> {
    if (method !== "thread/toolExecutionRequested" || !isRecord(params) || !isRecord(params.call)) return false;
    const { threadId, turnId, requestId, call } = params;
    if (
      typeof threadId !== "string" ||
      !threadId ||
      typeof turnId !== "string" ||
      !turnId ||
      typeof requestId !== "string" ||
      !requestId
    )
      return false;
    const tool = this.tools.find((entry) => entry.name === call.name);
    if (!tool) return false;
    const key = `${threadId}:${requestId}`;
    let result = this.results.get(key);
    if (!result) {
      result = this.execute(tool, call.arguments, { threadId, turnId, requestId });
      this.results.set(key, result);
    }
    const output = await result;
    await this.request("tools/resolve", { requestId, turnId, ...output });
    return true;
  }

  onResolved(params: unknown): void {
    if (!isRecord(params)) return;
    this.results.delete(`${params.threadId}:${params.requestId}`);
  }

  private async execute(tool: DesktopAgentTool, args: unknown, context: DesktopToolContext): Promise<ToolOutput> {
    try {
      const result = await tool.execute(args, context);
      return { output: typeof result === "string" ? result : (JSON.stringify(result) ?? "null"), isError: false };
    } catch (error) {
      return { output: error instanceof Error ? error.message : "Desktop tool failed", isError: true };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
