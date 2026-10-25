# Thread cost estimates

The thread-header cost popover estimates USD spend from `stats/tokens`, filtered
by each included thread and grouped by the model recorded for each turn. It reads
the engine's local analytics store; no prompts or usage are sent to OpenRouter.
Threads without recorded analytics show unavailable, not zero.

`src/data/openrouter-pricing.json` is a bundled snapshot of OpenRouter's public
model catalog, including its source URL and fetch timestamp. Runtime estimates
work offline. Refresh the snapshot before shipping updated prices:

```sh
node scripts/update-openrouter-pricing.mjs
```

The estimate charges uncached input and output at their respective token rates.
Cached input uses the cache-read rate where available, otherwise the input rate.
Both tabs show separate uncached-input, cache-read and output token counts and
their estimated costs when rates are known. Uncached input is prompt tokens minus
cache-read tokens, with cache reads clamped to the reported prompt total before
aggregating threads. The categories therefore do not count cached input twice.
Unknown rates leave counts visible without inventing a cost; missing/invalid
counts display unavailable. Thread rows aggregate the same categories across
their own models, while model rows combine matching models across included threads.
The released `TokenSummaryRow`/`stats/tokens` contract reports prompt, completion,
total and cached-prompt tokens, not cache-write or separate reasoning counts.
The popover explicitly says those breakdowns are not reported rather than showing
zero; output is not relabeled as non-reasoning output.
Model IDs must match exactly, or have an unambiguous unqualified ID. Unknown and
dynamic prices are excluded and explicitly marked; a partial total has a `+`.
Nonzero amounts below one cent display as `<$0.01` rather than zero.

This is not a bill. OpenRouter's current snapshot cannot establish historical
prices or actual subscription/provider charges. Cache-write premiums, tiered
pricing, tools and machines are not calculated.

The total combines this thread and its discovered subagent descendants. Discovery
reads persisted turns' subagent trace summaries and supplements them with
the live store, so completed children remain discoverable after restarting the app.
Each distinct child thread is queried once, even if several traces or turns refer
to it; cycles back to the parent are ignored. Trace-level usage is never added to
child analytics, avoiding double counting. The By thread tab shows self and each
child, while By model aggregates those same threads. Colored dots match the
contribution bar for the selected tab; unavailable costs have no bar segment.

In the embedded 0.3.17 release, core `runtime.rs` accumulates `turn_usage` from
that turn's inference stream, then emits it with its own thread ID. Analytics
`ingest.rs` records TurnCompleted/TurnFailed usage under that ID, and `query.rs`
filters `token_usage.thread_id` exactly. It does not roll child usage into parent
token statistics; descendant goal-budget accounting is a separate mechanism.

Discovery uses at most four concurrent requests and stops at 200 distinct threads.
Each refresh scans at most 32 turns per thread and 256 trace pages overall,
prioritizing the active turn followed by the most recent persisted turns. Older
children outside that window may be undiscovered; hitting either scan limit
explicitly marks the subtotal partial while preserving self and discovered costs.
Failed trace pages preserve successful siblings. Failed/empty analytics, missing
threads, unknown prices, truncated analytics and the discovery limit make the
subtotal explicitly partial, never a complete zero. Descendants whose records
cannot be discovered may be absent, and the partial warning states that limitation.
Hydration runs on mount/open and relevant completion notifications, not on render.
Overlapping refreshes are coalesced; child completion updates the total even when
the parent has no new turn.
