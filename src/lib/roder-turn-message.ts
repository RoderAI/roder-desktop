// A Roder turn is one user message: what the app adds (the brief, the board,
// what changed) between two marker lines, then the message itself. The engine
// keeps no per-turn context in a thread's history, so this is the only place
// the context stays in the conversation. The main process writes the markers
// (electron/roder-agents/turn-prompt.ts); the transcript shows only the message.

export const RODER_TURN_CONTEXT_START = "[Roder turn context: added by the app, not typed by the user]";
export const RODER_TURN_CONTEXT_END = "[End of Roder turn context]";

/** `context` and `message` as one Roder turn; `heading` says who the message is from. */
export function wrapRoderTurn(context: string, heading: string, message: string): string {
  return `${RODER_TURN_CONTEXT_START}\n${context}\n${RODER_TURN_CONTEXT_END}\n\n## ${heading}\n${message}`;
}

/** The message a Roder turn carries, without the app's context. Other text is returned as it is. */
export function roderTurnMessageText(text: string): string {
  if (!text.startsWith(`${RODER_TURN_CONTEXT_START}\n`)) return text;
  const end = text.indexOf(`\n${RODER_TURN_CONTEXT_END}\n`);
  if (end === -1) return text;
  return text.slice(end + RODER_TURN_CONTEXT_END.length + 2).replace(/^\n*## [^\n]*\n/, "");
}
