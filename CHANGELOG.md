# Changelog

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
