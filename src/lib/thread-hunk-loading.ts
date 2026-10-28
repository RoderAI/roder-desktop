import type { roderIpc } from "@/lib/roder-ipc";
import type { HunkRecord, WorkspaceChangeObservation } from "@/types/roder";

export function loadedTurnIdsKey(turns: readonly { id: string }[] | undefined): string {
  return JSON.stringify((turns ?? []).map((turn) => turn.id));
}

type HunkClient = Pick<typeof roderIpc, "listHunks" | "listWorkspaceChanges">;

export function threadHunkScopeKey(turnIds: readonly string[] | undefined): string {
  return turnIds === undefined ? "*" : JSON.stringify([...new Set(turnIds.filter(Boolean))].sort());
}

export async function loadThreadHunks(
  client: HunkClient,
  threadId: string,
  scopeKey: string,
  isDisposed: () => boolean = () => false,
): Promise<{ hunks: HunkRecord[]; observedChanges: WorkspaceChangeObservation[] }> {
  const scopes: (string | undefined)[] = scopeKey === "*" ? [undefined] : JSON.parse(scopeKey);
  const hunks: HunkRecord[][] = [];
  const observedChanges: WorkspaceChangeObservation[][] = [];
  const jobs = scopes.flatMap((turnId, index) => {
    const options = turnId === undefined ? {} : { turnId };
    return [
      async () => {
        hunks[index] = (await client.listHunks(threadId, options)).hunks;
      },
      async () => {
        try {
          observedChanges[index] = (await client.listWorkspaceChanges(threadId, options)).changes;
        } catch (error) {
          if (error instanceof Error && error.message.includes("Method not found")) {
            observedChanges[index] = [];
            return;
          }
          throw error;
        }
      },
    ];
  });
  let nextJob = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (!failed && !isDisposed() && nextJob < jobs.length) {
        const job = jobs[nextJob++];
        try {
          await job();
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return { hunks: hunks.flat(), observedChanges: observedChanges.flat() };
}
