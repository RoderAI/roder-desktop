import { expect, test, vi } from "vitest";
import type { CommandDescriptor } from "../src/types/roder";

async function loadCommandsStore(request: (method: string, params: unknown) => Promise<unknown>) {
  vi.resetModules();
  globalThis.window = {
    roderDesktop: {
      request,
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  } as unknown as Window & typeof globalThis;
  const module = await import("../src/stores/commands-store");
  module.useCommandsStore.setState({
    commands: [],
    loading: false,
    error: null,
    loaded: false,
  });
  return module.useCommandsStore;
}

test("load stores commands sorted by name", async () => {
  const useCommandsStore = await loadCommandsStore(async () => ({
    commands: [command({ name: "review" }), command({ name: "model" })],
  }));

  await useCommandsStore.getState().load();

  expect(useCommandsStore.getState().commands.map((item) => item.name)).toEqual(["model", "review"]);
  expect(useCommandsStore.getState().loaded).toBe(true);
  expect(useCommandsStore.getState().loading).toBe(false);
  expect(useCommandsStore.getState().error).toBeNull();
});

test("load failure marks commands loaded with an empty catalog", async () => {
  const useCommandsStore = await loadCommandsStore(async () => {
    throw new Error("method not found: commands/list");
  });

  await useCommandsStore.getState().load();

  expect(useCommandsStore.getState().commands).toEqual([]);
  expect(useCommandsStore.getState().loaded).toBe(true);
  expect(useCommandsStore.getState().loading).toBe(false);
  expect(useCommandsStore.getState().error).toBe("method not found: commands/list");
});

test("reload after failure replaces the empty catalog", async () => {
  let attempt = 0;
  const useCommandsStore = await loadCommandsStore(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error("temporarily unavailable");
    }
    return { commands: [command({ name: "review" })] };
  });

  await useCommandsStore.getState().load();
  await useCommandsStore.getState().load();

  expect(useCommandsStore.getState().commands.map((item) => item.name)).toEqual(["review"]);
  expect(useCommandsStore.getState().error).toBeNull();
});

test("concurrent loads share one commands/list request", async () => {
  const listResult = deferred<unknown>();
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => listResult.promise);
  const useCommandsStore = await loadCommandsStore(request);

  const firstLoad = useCommandsStore.getState().load();
  const secondLoad = useCommandsStore.getState().load();
  listResult.resolve({ commands: [command({ name: "review" })] });
  await Promise.all([firstLoad, secondLoad]);

  expect(request).toHaveBeenCalledTimes(1);
  expect(useCommandsStore.getState().commands.map((item) => item.name)).toEqual(["review"]);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function command(patch: Partial<CommandDescriptor>): CommandDescriptor {
  return {
    name: patch.name ?? "review",
    description: patch.description ?? "Review changes",
    argument_hint: patch.argument_hint ?? "[scope]",
    source: patch.source ?? "builtin",
    model: patch.model ?? null,
    agent: patch.agent ?? null,
    has_shell_includes: patch.has_shell_includes ?? false,
    has_url_includes: patch.has_url_includes ?? false,
  };
}
