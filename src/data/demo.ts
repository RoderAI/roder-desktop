import type { ConversationMessage, GodeThread } from "@/types/gode";

const now = Math.floor(Date.now() / 1000);

export const demoThreads: GodeThread[] = [
  {
    id: "demo-navigation-redirect",
    sessionId: "demo-navigation-redirect",
    preview: "Vex.sc navigation redirect issue",
    modelProvider: "codex",
    createdAt: now - 5_200,
    updatedAt: now - 220,
    status: { type: "idle" },
    cwd: "/Users/pz/w/vex",
    name: "Vex.sc navigation redirect issue",
  },
  {
    id: "demo-desktop-companion",
    sessionId: "demo-desktop-companion",
    preview: "Gode desktop companion design",
    modelProvider: "codex",
    createdAt: now - 2_100,
    updatedAt: now - 1_100,
    status: { type: "idle" },
    cwd: "/Users/pz/w/gode-desktop",
    name: "Gode desktop companion design",
  },
];

export const demoMessages: ConversationMessage[] = [
  {
    id: "demo-user-1",
    role: "user",
    text: "just use the global one and use the cloudflare apis to check",
    status: "complete",
  },
  {
    id: "demo-assistant-1",
    role: "assistant",
    text:
      "• Your origin on `:80` redirects to `https://vex.sc`, so Cloudflare kept re-requesting the same origin path and returned endless `308` to client.\n\n" +
      "What I changed in tunnel config:\n\n" +
      "• `vex.sc` ingress to HTTPS origin with proper TLS/SNI headers:\n" +
      "  • `service: https://178.104.168.16:443`\n" +
      "  • `originRequest.noTLSVerify: true`\n" +
      "  • `originRequest.originServerName: vex.sc`\n" +
      "  • `originRequest.httpHostHeader: vex.sc`\n" +
      "• Kept `hub.vex.sc` on:\n" +
      "  • `service: http://178.104.168.16:5000`\n\n" +
      "Live verification now:\n\n" +
      "• `https://vex.sc/` -> `200`\n" +
      "• `https://vex.sc/up` -> `200`\n" +
      "• `https://hub.vex.sc/v2/` -> `200`\n" +
      "• `curl -L --max-redirs 10 https://vex.sc/` no longer loops\n\n" +
      "One security note:\n\n" +
      "• Since your global key was shared in chat/session logs, rotate it in Cloudflare when convenient and use scoped API tokens for future debugging.",
    status: "complete",
  },
  {
    id: "demo-user-2",
    role: "user",
    text: "and it works now?",
    status: "complete",
  },
  {
    id: "demo-assistant-2",
    role: "assistant",
    text:
      "Yes, it works now.\n\n" +
      "I re-tested just now:\n\n" +
      "• `https://vex.sc/` returns `200`\n" +
      "• `https://vex.sc/up` returns `200`\n" +
      "• `https://hub.vex.sc/v2/` returns `200`\n" +
      "• Redirect loop is gone (`ERR_TOO_MANY_REDIRECTS` condition resolved)",
    status: "complete",
  },
];
