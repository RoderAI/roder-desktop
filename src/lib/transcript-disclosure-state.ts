export type TranscriptDisclosureState = Record<string, boolean>;

export function setTranscriptDisclosureOpen(
  state: TranscriptDisclosureState,
  key: string,
  open: boolean,
): TranscriptDisclosureState {
  if (state[key] === open) {
    return state;
  }
  return {
    ...state,
    [key]: open,
  };
}

export function pruneTranscriptDisclosureState(
  state: TranscriptDisclosureState,
  visibleKeys: Iterable<string>,
): TranscriptDisclosureState {
  const visibleKeySet = new Set(visibleKeys);
  const nextState: TranscriptDisclosureState = {};
  let changed = false;

  for (const [key, open] of Object.entries(state)) {
    if (visibleKeySet.has(key)) {
      nextState[key] = open;
      continue;
    }
    changed = true;
  }

  return changed ? nextState : state;
}
