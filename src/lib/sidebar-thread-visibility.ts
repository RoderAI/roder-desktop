export const COLLAPSED_THREAD_LIMIT = 5;

export type ThreadVisibility<T> = {
  visibleThreads: T[];
  primaryThreads: T[];
  overflowThreads: T[];
  hiddenCount: number;
  canShowMore: boolean;
  canShowLess: boolean;
};

export function visibleThreadsForGroup<T>(
  threads: T[],
  expanded: boolean,
  limit = COLLAPSED_THREAD_LIMIT,
): ThreadVisibility<T> {
  const primaryThreads = threads.slice(0, limit);
  const overflowThreads = threads.slice(limit);

  if (expanded || threads.length <= limit) {
    return {
      visibleThreads: threads,
      primaryThreads,
      overflowThreads,
      hiddenCount: 0,
      canShowMore: false,
      canShowLess: expanded && threads.length > limit,
    };
  }

  return {
    visibleThreads: primaryThreads,
    primaryThreads,
    overflowThreads,
    hiddenCount: threads.length - limit,
    canShowMore: true,
    canShowLess: false,
  };
}
