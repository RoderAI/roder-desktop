import { EventEmitter } from "node:events";
import type { BlaxelAuth } from "./credentials";

export type BlaxelTerminalOptions = {
  sandboxUrl: string;
  auth: BlaxelAuth;
  sessionId: string;
  workingDir?: string;
  cols: number;
  rows: number;
  createWebSocket?: (url: string, headers: Record<string, string>) => WebSocket;
};

type WebSocketWithHeadersCtor = new (
  url: string,
  init?: string | string[] | { headers?: Record<string, string> },
) => WebSocket;

export function buildBlaxelTerminalWsUrl(params: {
  sandboxUrl: string;
  cols: number;
  rows: number;
  sessionId: string;
  workingDir?: string;
}): string {
  const parsed = new URL(params.sandboxUrl);
  parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
  parsed.pathname = "/terminal/ws";
  parsed.searchParams.set("cols", String(Math.max(10, Math.round(params.cols))));
  parsed.searchParams.set("rows", String(Math.max(4, Math.round(params.rows))));
  parsed.searchParams.set("sessionId", params.sessionId);
  if (params.workingDir && params.workingDir.startsWith("/")) {
    parsed.searchParams.set("workingDir", params.workingDir);
  }
  return parsed.toString();
}

export class BlaxelTerminalSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private closed = false;
  private readonly pendingWrites: string[] = [];

  constructor(private readonly options: BlaxelTerminalOptions) {
    super();
    this.connect();
  }

  private connect(): void {
    const url = buildBlaxelTerminalWsUrl({
      sandboxUrl: this.options.sandboxUrl,
      cols: this.options.cols,
      rows: this.options.rows,
      sessionId: this.options.sessionId,
      workingDir: this.options.workingDir,
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.auth.apiKey}`,
      ...(this.options.auth.workspace ? { "X-Blaxel-Workspace": this.options.auth.workspace } : {}),
    };
    const factory =
      this.options.createWebSocket ??
      ((wsUrl: string, wsHeaders: Record<string, string>) => {
        const WsCtor = globalThis.WebSocket as unknown as WebSocketWithHeadersCtor;
        return new WsCtor(wsUrl, { headers: wsHeaders });
      });

    const ws = factory(url, headers);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.closed || this.ws !== ws) return;
      while (this.pendingWrites.length > 0) {
        const chunk = this.pendingWrites.shift();
        if (chunk !== undefined) {
          ws.send(JSON.stringify({ type: "input", data: chunk }));
        }
      }
    });

    ws.addEventListener("message", (event) => {
      if (this.closed || this.ws !== ws) return;
      const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
      try {
        const parsed = JSON.parse(raw) as { type?: unknown; data?: unknown };
        if (parsed.type === "output" && typeof parsed.data === "string") {
          this.emit("data", parsed.data);
          return;
        }
        if (parsed.type === "error" && typeof parsed.data === "string") {
          this.emit("data", `\r\n\x1b[31m${parsed.data}\x1b[0m\r\n`);
          return;
        }
      } catch {
        if (raw) {
          this.emit("data", raw);
        }
      }
    });

    ws.addEventListener("error", () => {
      if (this.closed || this.ws !== ws) return;
      this.emit("data", "\r\n\x1b[31m[Remote terminal connection error]\x1b[0m\r\n");
    });

    ws.addEventListener("close", (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.closed) {
        this.closed = true;
        const exitCode = event.code === 1000 ? 0 : 1;
        this.emit("exit", { exitCode });
      }
    });
  }

  write(data: string): void {
    if (this.closed) return;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: "input", data }));
      return;
    }
    this.pendingWrites.push(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed || cols <= 0 || rows <= 0) return;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: "resize", cols: Math.round(cols), rows: Math.round(rows) }));
    }
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "closed by roder-desktop");
    } catch {
      // ignore close errors
    }
  }
}
