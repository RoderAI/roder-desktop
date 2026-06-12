import { useLayoutEffect, useRef } from "react";

type AnyHandler = (...args: never[]) => unknown;

/**
 * Returns an object of function props with stable identities that always
 * delegate to the latest handlers passed in. This lets memoized children bail
 * out of re-renders even though the parent recreates its handlers per render.
 *
 * The key set must be identical on every render: wrappers are created once.
 */
export function useStableHandlers<T extends Record<string, AnyHandler>>(handlers: T): T {
  const latestRef = useRef(handlers);
  useLayoutEffect(() => {
    latestRef.current = handlers;
  });

  const stableRef = useRef<T | null>(null);
  stableRef.current ??= Object.fromEntries(
    Object.keys(handlers).map((key) => [
      key,
      (...args: never[]) => (latestRef.current[key] as (...callArgs: never[]) => unknown)(...args),
    ]),
  ) as T;
  return stableRef.current;
}
