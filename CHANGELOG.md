# Changelog

## 0.6.0 — UNRELEASED — MCP best-practice initiative

The "make `@leadbay/mcp` the example MCP server" rollout. Closes the
P1 / P2 / P3 priorities from the comprehensive eval doc.

### Spec primitive coverage

- **Tool annotations on every tool (spec MCP 2025-11-25 §Tools).** Each
  tool now declares `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`, plus a short `title`, so MCP clients (Claude Desktop,
  Cursor) can surface the right confirmation UX per tool. Defaults
  honour the per-tool truth: composite reads are read-only + idempotent;
  composite writes split into idempotent (bulk_qualify_leads,
  enrich_titles, import_leads, import_and_qualify) vs non-idempotent
  (refine_prompt, answer_clarification, adjust_audience-merging,
  report_outreach). 56 tools total. A vitest drift-catcher prevents
  future regressions.
- **`outputSchema` + `structuredContent` on top-5 composites**:
  `pull_leads`, `research_lead`, `account_status`,
  `bulk_qualify_leads`, `report_outreach` now declare typed output
  shapes and emit a matching `structuredContent` block on success.
  Capable clients consume the typed payload without re-parsing the
  text. Backwards-compatible.
- **`prompts/*` capability** with 5 canned slash-commands —
  `leadbay_daily_check_in`, `leadbay_research_a_domain`,
  `leadbay_refine_audience`, `leadbay_log_outreach`,
  `leadbay_qualify_top_n`. Each composes 2-3 tool calls and accepts
  parameterised arguments.
- **`resources/*` capability** with three URI schemes:
  `lead://{uuid}/profile`, `lens://{id}/definition`,
  `org://taste-profile`. Cache-friendly for clients that opt in.
- **`notifications/progress`** — long-running composites stream
  per-lead progress when the client passes `_meta.progressToken`.
  `bulk_qualify_leads` is the first adopter.
- **`notifications/cancelled` → `ToolContext.signal`** — client
  cancels now actually abort in-flight composite polling.

### Hardening

- **`additionalProperties: false` on every tool's inputSchema.** Closes
  the prompt-injection extra-field surface. **Behavior callout**: any
  client that was passing extra unrecognized fields will now get a
  schema rejection. Documented as a deliberate hardening; existing
  tools never advertised acceptance of those fields.
- **Security regression suite** — `packages/mcp/test/security.test.ts`
  covers: extra-field rejection, prototype-pollution payload, type
  confusion, oversized inputs, nested-additionalProperties on the
  `verification` field of `report_outreach`.

### Field renames + deprecations

- **`research_lead.qualification[]` boost_score canonical alias.** The
  field was previously labelled `score_0_to_10`; the actual scale is
  the discrete `-10|0|10|20` boost (NOT a 0–10 average). 0.6.0 ships
  `boost_score` as canonical alongside an explicit `score_scale:
  "-10|0|10|20"` field; `score_0_to_10` is kept as a deprecated alias
  for one minor version and removed in 0.7.0. See `MIGRATION.md`.

### Token economy

- **Pagination metadata**: `pull_leads` and `discover_leads` payloads
  now include `has_more: boolean` and `next_page: number | null`.
- **Truncation steering on `research_lead`**: when the response
  exceeds ~25k characters, `truncated: true` and `truncation_hint`
  surface, naming the argument that would reduce the payload
  (`concise: true`).

### Tests

- Total: 328+ unit tests across `@leadbay/core` and `@leadbay/mcp`.
- New: `annotations.test.ts` (drift catcher), `security.test.ts`
  (5 hostile-input shapes), `output-schema.test.ts` (top-5 round
  trip), `cancellation.test.ts` (signal wiring), `progress.test.ts`
  (event flow), `prompts.test.ts` (5 prompts round-trip),
  `resources.test.ts` (3 URI schemes round-trip).

## 0.3.0 — 2026-04-29

- **`@leadbay/mcp` 0.3.0**: closes [product#3504](https://github.com/leadbay/product/issues/3504) end-to-end. Composite write tools (`refine_prompt`, `report_outreach`, `adjust_audience`, `bulk_qualify_leads`, `enrich_titles`, `answer_clarification`, `import_leads`) are now ON by default — `LEADBAY_MCP_WRITE` defaults to `"1"`. The `SERVER_INSTRUCTIONS` is now built dynamically from the actual exposed tool set, so the system prompt no longer references tools the server doesn't register. `leadbay-mcp login` defaults to writing a 0600-mode credentials file at the platform-correct path (`$XDG_CONFIG_HOME/leadbay/credentials.json`, `~/Library/Application Support/leadbay/credentials.json`, or `%APPDATA%\leadbay\credentials.json`); pass `--unsafe-print-token` for legacy CI flows. `leadbay-mcp install` now registers Claude Code at `--scope user` so the MCP server is visible from any project. **Behavior callout**: in 0.2.x the parser only recognized `LEADBAY_MCP_WRITE === "1"` as ON; 0.3.0 also accepts `true|yes|on` as ON. See `packages/mcp/MIGRATION.md`.

## 0.2.5 — 2026-04-28

- **`@leadbay/mcp` 0.2.5** + **`@leadbay/leadclaw` 0.2.5**: new `leadbay_import_leads` composite write tool ([product#3537](https://github.com/leadbay/product/issues/3537)). Imports a list of company domains and returns Leadbay leadIds for the ones the crawler already knows, chainable into `leadbay_bulk_qualify_leads` and `leadbay_research_lead`. Writes user state (creates a CRM-imports row visible in the web UI). Gated behind `LEADBAY_MCP_WRITE=1` (MCP) and `exposeWrite: true` (OpenClaw). See package CHANGELOGs for full surface, error codes, and limitations.

## 0.1.0 — 2026-04-20

Initial release.

### Tools (11)

Read-only (enabled by default):
- `leadbay_login` — authenticate with email + password
- `leadbay_list_lenses` — list saved search configs
- `leadbay_discover_leads` — AI-recommended leads
- `leadbay_get_lead_profile` — full lead profile with AI scores and web insights
- `leadbay_get_lead_activities` — lead activity feed
- `leadbay_get_taste_profile` — organization ICP + intent tags + qualification questions
- `leadbay_get_contacts` — contacts for a lead
- `leadbay_get_quota` — enrichment credit balance

Write (opt-in, `optional: true`):
- `leadbay_qualify_lead` — trigger AI qualification
- `leadbay_enrich_contacts` — enrich email/phone
- `leadbay_add_note` — add a note to a lead

### Tests

- Contract test: manifest ↔ code parity
- Unit tests: client error mapping, caching, tool branches
- Live smoke tests (opt-in via `LEADBAY_TEST_TOKEN`)
