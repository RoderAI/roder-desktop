import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { shell } from "electron";

export type ChromeBridgeStatus = {
  state: "stopped" | "starting" | "running" | "error";
  url: string | null;
  token: string | null;
  tokenPreview: string | null;
  pairingUrl: string | null;
  pid: number | null;
  clientCount: number;
  lastEvent?: string;
  message?: string;
};

const protocol = "roder.remote.v1";

export class ChromeBridgeManager extends EventEmitter {
  #server: Server | null = null;
  #clients = new Set<Socket>();
  #status: ChromeBridgeStatus = stoppedStatus();

  status(): ChromeBridgeStatus {
    return this.#status;
  }

  async start(): Promise<ChromeBridgeStatus> {
    if (this.#server && this.#status.state === "running") {
      return this.#status;
    }

    await this.stop();
    const token = randomBytes(32).toString("base64url");
    this.#setStatus({
      state: "starting",
      url: null,
      token,
      tokenPreview: previewToken(token),
      pairingUrl: null,
      pid: process.pid,
      clientCount: 0,
      message: "Starting local Chrome bridge",
    });

    const server = createServer((socket) => this.#handleSocket(socket, token));
    this.#server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Chrome bridge did not bind a TCP address");
    }

    const url = `ws://127.0.0.1:${address.port}`;
    const pairingUrl = pairingLink(url, token);
    this.#setStatus({
      state: "running",
      url,
      token,
      tokenPreview: previewToken(token),
      pairingUrl,
      pid: process.pid,
      clientCount: 0,
    });
    return this.#status;
  }

  async stop(): Promise<ChromeBridgeStatus> {
    for (const client of this.#clients) {
      client.destroy();
    }
    this.#clients.clear();

    if (this.#server) {
      const server = this.#server;
      this.#server = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    this.#setStatus(stoppedStatus());
    return this.#status;
  }

  async restart(): Promise<ChromeBridgeStatus> {
    await this.stop();
    return this.start();
  }

  async openExtensionOptions(): Promise<void> {
    await shell.openExternal("chrome://extensions");
  }

  #handleSocket(socket: Socket, token: string): void {
    let handshake = "";
    let upgraded = false;

    socket.on("data", (chunk) => {
      if (!upgraded) {
        handshake += chunk.toString("utf8");
        if (!handshake.includes("\r\n\r\n")) {
          return;
        }
        upgraded = this.#upgrade(socket, handshake, token);
        if (!upgraded) {
          socket.destroy();
        }
        return;
      }

      for (const message of decodeFrames(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
        this.#setStatus({ ...this.#status, lastEvent: summarizeMessage(message) });
      }
    });

    socket.on("close", () => {
      this.#clients.delete(socket);
      this.#setStatus({ ...this.#status, clientCount: this.#clients.size });
    });
    socket.on("error", () => {
      this.#clients.delete(socket);
      this.#setStatus({ ...this.#status, clientCount: this.#clients.size });
    });
  }

  #upgrade(socket: Socket, request: string, token: string): boolean {
    const headers = parseHeaders(request);
    const key = headers.get("sec-websocket-key");
    const protocols = (headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const authorized = protocols.includes(protocol) && protocols.includes(`bearer.${token}`);

    if (!key || !authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
      this.#setStatus({ ...this.#status, lastEvent: "Rejected unauthorized Chrome bridge connection" });
      return false;
    }

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        `Sec-WebSocket-Protocol: ${protocol}`,
        "\r\n",
      ].join("\r\n"),
    );
    this.#clients.add(socket);
    this.#setStatus({ ...this.#status, clientCount: this.#clients.size, lastEvent: "Chrome extension connected" });
    return true;
  }

  #setStatus(status: ChromeBridgeStatus): void {
    this.#status = status;
    this.emit("status", status);
  }
}

function parseHeaders(request: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of request.split("\r\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function decodeFrames(chunk: Buffer): string[] {
  const messages: string[] = [];
  let offset = 0;
  while (offset + 2 <= chunk.length) {
    const first = chunk[offset++] ?? 0;
    const second = chunk[offset++] ?? 0;
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    if (length === 126) {
      if (offset + 2 > chunk.length) break;
      length = chunk.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (offset + 8 > chunk.length) break;
      const high = chunk.readUInt32BE(offset);
      const low = chunk.readUInt32BE(offset + 4);
      offset += 8;
      length = high * 2 ** 32 + low;
    }
    const masked = Boolean(second & 0x80);
    const mask = masked ? chunk.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    if (offset + length > chunk.length) break;
    const payload = Buffer.from(chunk.subarray(offset, offset + length));
    offset += length;
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
  }
  return messages;
}

function stoppedStatus(): ChromeBridgeStatus {
  return {
    state: "stopped",
    url: null,
    token: null,
    tokenPreview: null,
    pairingUrl: null,
    pid: null,
    clientCount: 0,
  };
}

function pairingLink(url: string, token: string): string {
  const payload = Buffer.from(
    JSON.stringify({ type: protocol, name: "Roder Desktop", url, subprotocols: [protocol, `bearer.${token}`] }),
    "utf8",
  ).toString("base64url");
  return `roder://connect?payload=${payload}`;
}

function previewToken(token: string): string {
  return token.length <= 8 ? "*".repeat(token.length) : `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function summarizeMessage(message: string): string {
  try {
    const parsed = JSON.parse(message) as { type?: unknown; method?: unknown };
    const label = typeof parsed.type === "string" ? parsed.type : typeof parsed.method === "string" ? parsed.method : "message";
    return `Extension: ${label}`;
  } catch {
    return `Extension message (${message.length} bytes)`;
  }
}