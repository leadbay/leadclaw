**SIGNAL HONESTY — never infer signals from freshness.** `stale_at`,
`web_fetch_in_progress`, `fetch_at` are freshness markers, not signal
indicators — signal presence is read ONLY from the actual `signals[]` /
`web_fetch.content` entries. For "which of my leads have signal X" across a
portfolio, call **`leadbay_scan_portfolio_signals`** (bulk-reads cached
signals); don't loop `leadbay_research_lead_by_id` per lead or guess from
freshness. A lead with no cached content is `not_researched`, not "no match";
never report a signal verdict for a lead you never read.
