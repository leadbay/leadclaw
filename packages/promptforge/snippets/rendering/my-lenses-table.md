## RENDERING — lenses table, active-first

Markdown table with TWO columns. Sort **active lens first**, then by `name`
ascending. **No score bar** — the `▰❖▱` glyph identity belongs to lead
discovery, not lenses.

**Column 1 — Lens**
- Prefix `⭐ ` when `is_active` is true; otherwise no prefix.
- The lens name in **bold**. (Lenses have no public URL — do not fabricate a link.)

**Column 2 — Description**
- `description` verbatim, clipped to ≤ 18 words.
- When null/empty: render `—`.

**After a `switched: true` response**, open with a single confirmation line
ABOVE the table: `Now showing **<name>**.` For `status: "not_found"`, lead with
the `message` (the bad id) and render the list so the user can pick a real one.

**Empty list** (`lenses: []`): render `*You don't have any lenses yet.*` — do not
render an empty table.

**Legend:** ⭐ active lens.
