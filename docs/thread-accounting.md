# Thread accounting

The thread usage popover reports recorded tokens and an API cost estimate. It is
not an invoice or a measurement of subscription spending.

## Sources and scope

- Cumulative `thread.usage` supplies a persistent thread's own token counts.
  These counters include work such as native compaction that model analytics
  may omit. They do not include child threads.
- Model-grouped `stats/tokens` supplies historical model attribution. Its limit
  bounds model groups, not turns.
- Paginated `thread/list` parent links discover persistent subagents. Ordinary
  workspace forks are not automatically counted as subagents.
- Per-turn traces discover task agents, archived descendants, and agents not
  represented in the thread index. When a child has no analytics, validated
  token counters from its trace provide a partial fallback.

Persistent thread usage takes precedence over trace snapshots. Repeated traces
for a child turn are deduplicated. The cost tree never sums child transcript
turns: a child may inherit its parent's turn history, including old usage.

Recorded token totals reconcile cumulative metadata and model analytics without
adding overlapping counters. Tokens missing from model analytics stay visible
but are not assigned to the thread's current model or silently priced.

## Pricing

Input is separated into uncached input, cache reads, and cache writes; cached
tokens are subsets of input, not extra tokens. Output is charged separately.
Prices come from the dated bundled OpenRouter snapshot.

When exactly one model accounts for the thread's input and output totals,
cumulative cache counters can restore information lost by analytics. Across
multiple models, missing cache attribution remains unknown. Unknown cache-write
prices are not guessed. Known price components survive as a partial estimate.

The display also marks disagreement between metadata and analytics, missing
failed/interrupted-turn usage, non-default service tiers, failed discovery,
missing model rates, and bounded history scans. Refresh retries the available
records; **Scan more history** expands the search budget.

## Current upstream limits

The pinned harness does not send live inference token counters over desktop's
stdio transport. Usage refreshes after terminal notifications, with a delayed
recheck because analytics persistence is asynchronous.

Roder 0.3.19 accumulates configured task-agent usage across inference rounds and
preserves observed usage on failures and interruptions, including active-turn
native compaction. Records written by older versions can still contain only a
task agent's latest inference step or omit failed-turn usage; upgrading cannot
reconstruct those missing historical counts.

Analytics still loses cache-write attribution, service tiers, and some
within-turn model changes. Providers or external SDKs can also omit usage before
reporting an error. Trace-derived and incomplete totals therefore remain
explicitly partial.

Archived descendants can be absent from the thread index, and very long
histories may exceed the current scan budget. The popover reports these coverage
limits rather than presenting a complete charge.
