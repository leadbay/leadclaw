## RENDERING — markdown table, three columns

Present the response as a markdown table sorted by validated engagement first (liked → org_contacts_count → prospecting_actions_count), then `ai_agent_score` descending. Three columns exactly. Do not summarize in prose.

**Column 1 — Company**

- Line 1: linked company name. Link target: `website` (prefix `https://` if it's a bare hostname). If `website` is null, render the name as plain text — do not synthesize a search URL.
- Insert `<br>` between lines.
- Line 2: `sector` · size chip. Size chip: `"Xk+"` when `size_min >= 1000`, `"min–max"` when both present, `"min+"` when only min, `"≤max"` when only max, omit when both null.

**Column 2 — Signal**

- Engagement chips: `♥` when `engagement.liked` is true, `Nc` when `engagement.org_contacts_count > 0`, `Na` when `engagement.prospecting_actions_count > 0`. Omit zero values.
- Then ` · ` then the first sentence of `description` (≤25 words; trim with `…` if longer). If `description` is null, use the highest-score `qq_answers[].answer` (also trimmed).
- One cell, no line breaks, no bullet lists.

**Column 3 — Fit**

- Top 2 entries from `tags` (already sorted by score descending) as inline-code chips: `` `tag-a` `tag-b` ``.
- Then ` · ` then `ai_agent_score` formatted as `AI N` (0–99) when not null; omit when null.

**Hide from the user (never include in any cell):** `lead_id`, `org_lead_status`, raw `qq_answers` objects (use only the highest-score answer's text as fallback for column 2), `size_min`/`size_max` numerics (always render as a chip).

**After the table, in prose:** "Recommended seeds: <comma-separated company names of the top 3–5 by engagement>. Pass their `lead_id`s to `leadbay_extend_lens` as `seed_lead_ids`." Do NOT show raw UUIDs to the user — the agent carries them forward internally.
