/** Hold the last rendered value while the window is unfocused; recompute once on return. */
export function createForegroundSnapshot<T, S>(derive: (state: S) => T, initial: T) {
  let snapshot = initial;
  return (state: S, foreground: boolean): T => {
    if (foreground) snapshot = derive(state);
    return snapshot;
  };
}
