**SIGNAL HONESTY — never infer signals from freshness.** `stale_at`,
`web_fetch_in_progress`, `fetch_at` and `web_insights_fetched_at` are
FRESHNESS markers, not signal indicators. A fresh timestamp does **not** mean a
given signal (M&A, funding, a new hire, a CEO change) is present; a stale or
missing one does **not** mean it's absent. The presence of a signal is
determined ONLY by reading the actual `signals[]` / `web_fetch.content`
entries.

To answer "which of my leads have signal X" across a portfolio, call
**`leadbay_scan_portfolio_signals`** — it bulk-reads the cached signals and
filters them for you. Do NOT loop `leadbay_research_lead_by_id` one lead at a
time, and do NOT guess from list-level freshness flags.

If a lead has no cached signal content, say so honestly — "not yet researched,
want me to qualify it?" — and surface it as `not_researched`. Never fabricate
or imply a scan you didn't actually run, and never report a confident
signal-presence verdict for a lead whose signals you never read.
